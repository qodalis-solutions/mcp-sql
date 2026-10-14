/**
 * Live integration test. Runs only when RUN_INTEGRATION=1 and POSTGRES_* point
 * at a reachable PostgreSQL server (the CI job uses a postgres:17 service; locally
 * `docker run -e POSTGRES_USER=mcp -e POSTGRES_PASSWORD=mcp -e POSTGRES_DB=mcp -p 5432:5432 postgres:17-alpine`).
 * It creates its own schema `mcp_it` and drops it again at the end.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { PoolManager } from '@qodalis/mcp-sql-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createPostgresServer } from '../../src/server.js';
import { PgExecutor, type PgPoolLike } from '../../src/sql/executor.js';
import { createPgPool, toPgConfig } from '../../src/sql/pg-pool.js';

const enabled = process.env.RUN_INTEGRATION === '1' && Boolean(process.env.POSTGRES_HOST);

const text = (result: { content: unknown[] }): string =>
    (result.content[0] as { text: string }).text;

const SCHEMA = 'mcp_it';

const SETUP_SQL = `
drop schema if exists ${SCHEMA} cascade;
create schema ${SCHEMA};
create table ${SCHEMA}.customers (
    id serial primary key,
    name text not null,
    created_at timestamptz not null default now()
);
comment on table ${SCHEMA}.customers is 'People we invoice';
create table ${SCHEMA}.orders (
    id bigserial primary key,
    customer_id int not null references ${SCHEMA}.customers (id) on delete cascade,
    total numeric(12, 2) not null,
    placed_on date not null default current_date
);
create index orders_customer_idx on ${SCHEMA}.orders (customer_id);
create view ${SCHEMA}.big_orders as select * from ${SCHEMA}.orders where total > 100;
create function ${SCHEMA}.order_count(cid int) returns bigint language sql stable as $$
    select count(*) from ${SCHEMA}.orders where customer_id = cid
$$;
insert into ${SCHEMA}.customers (name) select 'customer ' || g from generate_series(1, 50) as g;
insert into ${SCHEMA}.orders (customer_id, total) select (g % 50) + 1, g * 7.5 from generate_series(1, 300) as g;
analyze ${SCHEMA}.customers;
analyze ${SCHEMA}.orders;
`;

describe.skipIf(!enabled)('live PostgreSQL', () => {
    let client: Client;
    let manager: PoolManager<PgPoolLike>;
    let admin: pg.Client;

    beforeAll(async () => {
        const config = loadConfig(process.env);
        admin = new pg.Client(toPgConfig(config, config.database));
        await admin.connect();
        await admin.query(SETUP_SQL);

        manager = new PoolManager({
            createPool: createPgPool(config),
            log: (m) => process.stderr.write(`${m}\n`),
        });
        const executor = new PgExecutor(manager, { maxRows: config.maxRows });
        const server = createPostgresServer({
            config,
            executor,
            poolState: (db) => manager.describe(db),
        });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        client = new Client({ name: 'integration', version: '0.0.0' });
        await client.connect(clientTransport);
    }, 30000);

    afterAll(async () => {
        await client?.close();
        await manager?.closeAll();
        await admin?.query(`drop schema if exists ${SCHEMA} cascade`);
        await admin?.end();
    });

    it('test_connection succeeds', async () => {
        const result = await client.callTool({ name: 'test_connection', arguments: {} });
        const parsed = JSON.parse(text(result));

        expect(result.isError).toBeFalsy();
        expect(parsed.ok).toBe(true);
        expect(parsed.pool.connected).toBe(true);
    }, 30000);

    it('get_server_info returns a version', async () => {
        const parsed = JSON.parse(
            text(await client.callTool({ name: 'get_server_info', arguments: {} })),
        );
        expect(parsed.serverVersion).toMatch(/^\d+/);
        expect(parsed.database).toBe(process.env.POSTGRES_DATABASE);
    });

    it('list_databases hides templates', async () => {
        const parsed = JSON.parse(
            text(await client.callTool({ name: 'list_databases', arguments: {} })),
        );
        const names = parsed.rows.map((row: unknown[]) => row[0]);
        expect(names).toContain(process.env.POSTGRES_DATABASE);
        expect(names).not.toContain('template0');
    });

    it('list_tables, describe_table and sample_data work on a real table', async () => {
        const tables = JSON.parse(
            text(await client.callTool({ name: 'list_tables', arguments: { schema: SCHEMA } })),
        );
        expect(tables.columns).toEqual(['schema', 'name', 'kind', 'rowCount', 'size', 'comment']);
        expect(tables.rows.map((row: unknown[]) => row[1])).toEqual(['customers', 'orders']);
        const customers = tables.rows[0] as unknown[];
        expect(customers[3]).toBe(50);
        expect(customers[5]).toBe('People we invoice');

        const described = JSON.parse(
            text(
                await client.callTool({
                    name: 'describe_table',
                    arguments: { table: `${SCHEMA}.orders` },
                }),
            ),
        );
        expect(described.columns.map((c: { name: string }) => c.name)).toEqual([
            'id',
            'customer_id',
            'total',
            'placed_on',
        ]);
        expect(described.columns[2].type).toBe('numeric(12,2)');
        expect(described.indexes.map((i: { name: string }) => i.name).sort()).toEqual([
            'orders_customer_idx',
            'orders_pkey',
        ]);
        expect(described.foreignKeys).toHaveLength(1);
        expect(described.foreignKeys[0]).toMatchObject({
            direction: 'outgoing',
            fromColumns: 'customer_id',
            onDelete: 'CASCADE',
            toTable: `${SCHEMA}.customers`,
        });

        const sample = await client.callTool({
            name: 'sample_data',
            arguments: { table: `${SCHEMA}.orders`, limit: 2, columns: ['id', 'total'] },
        });
        expect(sample.isError).toBeFalsy();
        const parsed = JSON.parse(text(sample));
        expect(parsed.columns).toEqual(['id', 'total']);
        expect(parsed.rows).toHaveLength(2);
    }, 60000);

    it('list_views, list_procedures, get_object_definition and search_objects find the fixtures', async () => {
        const views = JSON.parse(
            text(await client.callTool({ name: 'list_views', arguments: { schema: SCHEMA } })),
        );
        expect(views.rows.map((row: unknown[]) => row[1])).toEqual(['big_orders']);

        const routines = JSON.parse(
            text(await client.callTool({ name: 'list_procedures', arguments: { schema: SCHEMA } })),
        );
        expect(routines.rows[0]).toEqual([
            SCHEMA,
            'order_count',
            'function',
            'sql',
            'cid integer',
            'bigint',
            null,
        ]);

        const viewDef = text(
            await client.callTool({
                name: 'get_object_definition',
                arguments: { name: `${SCHEMA}.big_orders` },
            }),
        );
        expect(viewDef).toMatch(/^-- view mcp_it\.big_orders/);
        expect(viewDef).toMatch(/total > 100/);

        const fnDef = text(
            await client.callTool({
                name: 'get_object_definition',
                arguments: { name: `${SCHEMA}.order_count` },
            }),
        );
        expect(fnDef).toMatch(/CREATE OR REPLACE FUNCTION mcp_it\.order_count/);

        const search = JSON.parse(
            text(
                await client.callTool({ name: 'search_objects', arguments: { pattern: 'order' } }),
            ),
        );
        const kinds = new Set(search.rows.map((row: unknown[]) => row[0]));
        expect(kinds).toContain('table');
        expect(kinds).toContain('view');
        expect(kinds).toContain('function');

        const columns = JSON.parse(
            text(
                await client.callTool({
                    name: 'search_objects',
                    arguments: { pattern: 'customer_', types: ['column'] },
                }),
            ),
        );
        expect(columns.rows).toEqual([
            ['column', `${SCHEMA}.big_orders`, 'customer_id'],
            ['column', `${SCHEMA}.orders`, 'customer_id'],
        ]);
    });

    it('get_foreign_keys and get_table_stats cover the schema', async () => {
        const fks = JSON.parse(
            text(
                await client.callTool({
                    name: 'get_foreign_keys',
                    arguments: { table: `${SCHEMA}.customers` },
                }),
            ),
        );
        expect(fks.rows).toHaveLength(1);

        const stats = JSON.parse(
            text(
                await client.callTool({
                    name: 'get_table_stats',
                    arguments: { table: `${SCHEMA}.orders` },
                }),
            ),
        );
        expect(stats.columns).toContain('deadRows');
        expect(stats.rows[0][2]).toBe(300);
    });

    it('execute_query binds parameters, caps rows and keeps column order', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: {
                sql: `select id, total from ${SCHEMA}.orders where total > @min order by id`,
                params: { min: 10 },
                maxRows: 5,
            },
        });
        const parsed = JSON.parse(text(result));

        expect(result.isError).toBeFalsy();
        expect(parsed.columns).toEqual(['id', 'total']);
        expect(parsed.rows).toHaveLength(5);
        expect(parsed.rows[0]).toEqual([2, '15.00']);
        expect(parsed.truncated).toBe(true);
    });

    it('execute_query runs a multi-statement temp-table batch in read-only mode', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: {
                sql: `create temp table tmp_totals as select customer_id, sum(total) as total from ${SCHEMA}.orders group by customer_id;
                      select count(*)::int as n from tmp_totals;`,
            },
        });
        const parsed = JSON.parse(text(result));

        expect(result.isError).toBeFalsy();
        expect(parsed.rows).toEqual([[50]]);
    });

    it('execute_query returns SQL errors with code and position', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'select 1\nfrom no_such_table_xyz' },
        });

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/42P01/);
        expect(text(result)).toMatch(/no_such_table_xyz/);
    });

    it('read-only mode blocks writes without hitting the server', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: `insert into ${SCHEMA}.customers (name) values ('nope')` },
        });
        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/read-only/i);

        const count = await admin.query(`select count(*)::int as n from ${SCHEMA}.customers`);
        expect(count.rows[0].n).toBe(50);
    });

    it('recovers after the pool is forcibly closed underneath it', async () => {
        const config = loadConfig(process.env);
        const pool = await manager.getPool(config.database);
        await pool.close();
        expect(pool.connected).toBe(false);

        const result = await client.callTool({ name: 'test_connection', arguments: {} });
        const parsed = JSON.parse(text(result));

        expect(parsed.ok).toBe(true);
        expect(parsed.pool.connected).toBe(true);
    }, 30000);

    it('recovers after the server terminates the backend', async () => {
        const first = JSON.parse(
            text(
                await client.callTool({
                    name: 'execute_query',
                    arguments: { sql: 'select pg_backend_pid() as pid' },
                }),
            ),
        );
        const pid = first.rows[0][0] as number;
        await admin.query('select pg_terminate_backend($1)', [pid]);

        const second = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'select pg_backend_pid() as pid' },
        });
        expect(second.isError).toBeFalsy();
        expect(JSON.parse(text(second)).rows[0][0]).not.toBe(pid);
    }, 30000);
});
