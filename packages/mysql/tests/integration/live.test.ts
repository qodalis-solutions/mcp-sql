/**
 * Live integration test. Runs only when RUN_INTEGRATION=1 and MYSQL_* point at
 * a reachable MySQL/MariaDB server (CI uses a mysql:8.4 service; locally
 * `docker run -d --name mcp-sql-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_USER=mcp -e MYSQL_PASSWORD=mcp -e MYSQL_DATABASE=mcp -p 3306:3306 mysql:8.4`).
 * It creates its own `it_*` objects inside the configured database and drops them again.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { PoolManager } from '@qodalis/mcp-sql-core';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createMysqlServer } from '../../src/server.js';
import { MysqlExecutor, type MysqlPoolLike } from '../../src/sql/executor.js';
import { createMysqlPool, toMysqlConfig } from '../../src/sql/mysql-pool.js';

const enabled = process.env.RUN_INTEGRATION === '1' && Boolean(process.env.MYSQL_HOST);

const text = (result: { content: unknown[] }): string =>
    (result.content[0] as { text: string }).text;

const DB = process.env.MYSQL_DATABASE ?? 'mcp';

const SETUP_SQL = `
drop view if exists it_big_orders;
drop procedure if exists it_order_count;
drop table if exists it_orders;
drop table if exists it_customers;
create table it_customers (
    id int auto_increment primary key,
    name varchar(100) not null,
    created_at timestamp not null default current_timestamp
) comment = 'People we invoice';
create table it_orders (
    id bigint auto_increment primary key,
    customer_id int not null,
    total decimal(12, 2) not null,
    placed_on date not null default (current_date),
    constraint it_orders_customer_fk foreign key (customer_id) references it_customers (id) on delete cascade,
    index it_orders_customer_idx (customer_id)
);
create view it_big_orders as select * from it_orders where total > 100;
create procedure it_order_count(in cid int) reads sql data select count(*) as n from it_orders where customer_id = cid;
insert into it_customers (name)
    with recursive seq as (select 1 as g union all select g + 1 from seq where g < 50)
    select concat('customer ', g) from seq;
insert into it_orders (customer_id, total)
    with recursive seq as (select 1 as g union all select g + 1 from seq where g < 300)
    select (g % 50) + 1, g * 7.5 from seq;
analyze table it_customers;
analyze table it_orders;
`;

const TEARDOWN_SQL = `
drop view if exists it_big_orders;
drop procedure if exists it_order_count;
drop table if exists it_orders;
drop table if exists it_customers;
`;

describe.skipIf(!enabled)('live MySQL', () => {
    let client: Client;
    let manager: PoolManager<MysqlPoolLike>;
    let admin: mysql.Connection;

    beforeAll(async () => {
        const config = loadConfig(process.env);
        admin = await mysql.createConnection({
            ...toMysqlConfig(config, config.database),
            multipleStatements: true,
        });
        await admin.query(SETUP_SQL);

        manager = new PoolManager({
            createPool: createMysqlPool(config),
            log: (m) => process.stderr.write(`${m}\n`),
        });
        const executor = new MysqlExecutor(manager, {
            maxRows: config.maxRows,
            queryTimeoutMs: config.requestTimeoutMs,
        });
        const server = createMysqlServer({
            config,
            executor,
            poolState: (db) => manager.describe(db),
        });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        client = new Client({ name: 'integration', version: '0.0.0' });
        await client.connect(clientTransport);
    }, 60000);

    afterAll(async () => {
        await client?.close();
        await manager?.closeAll();
        await admin?.query(TEARDOWN_SQL);
        await admin?.end();
    });

    it('test_connection succeeds', async () => {
        const result = await client.callTool({ name: 'test_connection', arguments: {} });
        const parsed = JSON.parse(text(result));

        expect(result.isError).toBeFalsy();
        expect(parsed.ok).toBe(true);
        expect(parsed.pool.connected).toBe(true);
    }, 30000);

    it('get_server_info returns a version and the current database', async () => {
        const parsed = JSON.parse(
            text(await client.callTool({ name: 'get_server_info', arguments: {} })),
        );
        expect(parsed.version).toMatch(/^\d+\./);
        expect(parsed.database).toBe(DB);
    });

    it('list_databases hides the system schemas', async () => {
        const parsed = JSON.parse(
            text(await client.callTool({ name: 'list_databases', arguments: {} })),
        );
        const names = parsed.rows.map((row: unknown[]) => row[0]);
        expect(names).toContain(DB);
        expect(names).not.toContain('mysql');
    });

    it('list_tables, describe_table and sample_data work on a real table', async () => {
        const tables = JSON.parse(
            text(
                await client.callTool({ name: 'list_tables', arguments: { nameContains: 'it_' } }),
            ),
        );
        expect(tables.columns).toEqual([
            'schema',
            'name',
            'engine',
            'rowCount',
            'sizeBytes',
            'comment',
            'createTime',
            'updateTime',
        ]);
        expect(tables.rows.map((row: unknown[]) => row[1])).toEqual(['it_customers', 'it_orders']);
        const customers = tables.rows[0] as unknown[];
        expect(customers[2]).toBe('InnoDB');
        expect(customers[3]).toBeGreaterThan(0);
        expect(customers[5]).toBe('People we invoice');

        const described = JSON.parse(
            text(
                await client.callTool({
                    name: 'describe_table',
                    arguments: { table: 'it_orders' },
                }),
            ),
        );
        expect(described.table).toBe(`${DB}.it_orders`);
        expect(described.columns.map((c: { name: string }) => c.name)).toEqual([
            'id',
            'customer_id',
            'total',
            'placed_on',
        ]);
        expect(described.columns[2].type).toBe('decimal(12,2)');
        expect(described.columns[0]).toMatchObject({ identity: 1, nullable: 0, key: 'PRI' });
        expect(described.indexes.map((i: { name: string }) => i.name).sort()).toEqual([
            'PRIMARY',
            'it_orders_customer_idx',
        ]);
        expect(described.foreignKeys).toHaveLength(1);
        expect(described.foreignKeys[0]).toMatchObject({
            direction: 'outgoing',
            fromColumns: 'customer_id',
            onDelete: 'CASCADE',
            toTable: `${DB}.it_customers`,
        });

        const sample = await client.callTool({
            name: 'sample_data',
            arguments: { table: 'it_orders', limit: 2, columns: ['id', 'total'] },
        });
        expect(sample.isError).toBeFalsy();
        const parsed = JSON.parse(text(sample));
        expect(parsed.columns).toEqual(['id', 'total']);
        expect(parsed.rows).toHaveLength(2);
    }, 60000);

    it('list_views, list_procedures, get_object_definition and search_objects find the fixtures', async () => {
        const views = JSON.parse(
            text(await client.callTool({ name: 'list_views', arguments: { nameContains: 'it_' } })),
        );
        expect(views.rows.map((row: unknown[]) => row[1])).toEqual(['it_big_orders']);

        const routines = JSON.parse(
            text(
                await client.callTool({
                    name: 'list_procedures',
                    arguments: { nameContains: 'it_' },
                }),
            ),
        );
        expect(routines.rows[0]?.slice(0, 5)).toEqual([
            DB,
            'it_order_count',
            'procedure',
            null,
            'IN cid int',
        ]);

        const viewDef = text(
            await client.callTool({
                name: 'get_object_definition',
                arguments: { name: 'it_big_orders' },
            }),
        );
        expect(viewDef).toMatch(new RegExp(`^-- view ${DB}\\.it_big_orders`));
        expect(viewDef).toMatch(/total.*> 100/);

        const procDef = text(
            await client.callTool({
                name: 'get_object_definition',
                arguments: { name: 'it_order_count' },
            }),
        );
        expect(procDef).toMatch(/^-- procedure/);
        expect(procDef).toMatch(/count\(\*\)/);

        const search = JSON.parse(
            text(
                await client.callTool({
                    name: 'search_objects',
                    arguments: { pattern: 'it_order' },
                }),
            ),
        );
        const kinds = new Set(search.rows.map((row: unknown[]) => row[0]));
        expect(kinds).toContain('table');
        expect(kinds).toContain('procedure');

        const columns = JSON.parse(
            text(
                await client.callTool({
                    name: 'search_objects',
                    arguments: { pattern: 'customer_', types: ['column'] },
                }),
            ),
        );
        expect(columns.rows).toEqual([
            ['column', `${DB}.it_big_orders`, 'customer_id'],
            ['column', `${DB}.it_orders`, 'customer_id'],
        ]);
    });

    it('get_foreign_keys and get_table_stats cover the fixtures', async () => {
        const fks = JSON.parse(
            text(
                await client.callTool({
                    name: 'get_foreign_keys',
                    arguments: { table: 'it_customers' },
                }),
            ),
        );
        expect(fks.rows).toHaveLength(1);
        expect(fks.rows[0][0]).toBe('it_orders_customer_fk');

        const stats = JSON.parse(
            text(
                await client.callTool({
                    name: 'get_table_stats',
                    arguments: { table: 'it_orders' },
                }),
            ),
        );
        expect(stats.columns).toContain('dataKb');
        expect(stats.rows[0][3]).toBeGreaterThan(0);
    });

    it('execute_query binds parameters, caps rows, keeps column order and returns numbers for bigint', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: {
                sql: 'select id, total from it_orders where total > @min order by id',
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

    it('execute_query runs a multi-statement temporary-table batch in read-only mode', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: {
                sql: `create temporary table tmp_totals as select customer_id, sum(total) as total from it_orders group by customer_id;
                      select count(*) as n from tmp_totals;`,
            },
        });
        const parsed = JSON.parse(text(result));

        expect(result.isError).toBeFalsy();
        expect(parsed.rows).toEqual([[50]]);
    });

    it('execute_query returns SQL errors with the driver code', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'select 1\nfrom no_such_table_xyz' },
        });

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/ER_NO_SUCH_TABLE/);
        expect(text(result)).toMatch(/no_such_table_xyz/);
    });

    it('read-only mode blocks writes without hitting the server', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: "insert into it_customers (name) values ('nope')" },
        });
        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/read-only/i);

        const [rows] = await admin.query<mysql.RowDataPacket[]>(
            'select count(*) as n from it_customers',
        );
        expect(rows[0]?.n).toBe(50);
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

    it('recovers after the server kills the connection', async () => {
        const first = JSON.parse(
            text(
                await client.callTool({
                    name: 'execute_query',
                    arguments: { sql: 'select connection_id() as id' },
                }),
            ),
        );
        const id = first.rows[0][0] as number;
        await admin.query('kill connection ?', [id]);

        const second = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'select connection_id() as id' },
        });
        expect(second.isError).toBeFalsy();
        expect(JSON.parse(text(second)).rows[0][0]).not.toBe(id);
    }, 30000);
});
