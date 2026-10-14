/**
 * Live integration test. Runs only when RUN_INTEGRATION=1 and ORACLE_* point at
 * a reachable Oracle Database (locally: `docker run -d --name mcp-sql-oracle
 * -e ORACLE_PASSWORD=oracle -e APP_USER=mcp -e APP_USER_PASSWORD=mcp -p 1521:1521
 * gvenzl/oracle-free:23-slim-faststart`, service FREEPDB1). It creates its own
 * IT_* objects in the MCP user's schema and drops them again at the end.
 * ORACLE_ADMIN_PASSWORD (default "oracle") is the SYSTEM password used to kill
 * the session in the recovery test; that test is skipped when SYSTEM cannot log in.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { PoolManager } from '@qodalis/mcp-sql-core';
import oracledb from 'oracledb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createOracleServer } from '../../src/server.js';
import { OracleExecutor, type OraclePoolLike } from '../../src/sql/executor.js';
import { createOraclePool } from '../../src/sql/oracle-pool.js';

const enabled = process.env.RUN_INTEGRATION === '1' && Boolean(process.env.ORACLE_HOST);

const text = (result: { content: unknown[] }): string =>
    (result.content[0] as { text: string }).text;

const SETUP = [
    `create table it_customers (id number(10) generated always as identity primary key, name varchar2(100) not null, created_at timestamp default systimestamp not null)`,
    `comment on table it_customers is 'People we invoice'`,
    `create table it_orders (id number(19) generated always as identity primary key, customer_id number(10) not null references it_customers (id) on delete cascade, total number(12, 2) not null, placed_on date default sysdate not null, notes clob)`,
    `create index it_orders_customer_idx on it_orders (customer_id)`,
    `create view it_big_orders as select * from it_orders where total > 100`,
    `create function it_order_count(cid number) return number is n number; begin select count(*) into n from it_orders where customer_id = cid; return n; end;`,
    `insert into it_customers (name) select 'customer ' || level from dual connect by level <= 50`,
    `insert into it_orders (customer_id, total) select mod(level, 50) + 1, level * 7.5 from dual connect by level <= 300`,
    `begin dbms_stats.gather_table_stats(user, 'IT_CUSTOMERS'); dbms_stats.gather_table_stats(user, 'IT_ORDERS'); end;`,
];

const TEARDOWN = [
    'drop function it_order_count',
    'drop view it_big_orders',
    'drop table it_orders purge',
    'drop table it_customers purge',
];

const runAll = async (
    connection: { execute: (sql: string) => Promise<unknown> },
    statements: string[],
): Promise<void> => {
    for (const statement of statements) {
        try {
            await connection.execute(statement);
        } catch (error) {
            if (!/ORA-00942|ORA-04043/.test(String(error))) {
                throw error;
            }
        }
    }
};

describe.skipIf(!enabled)('live Oracle', () => {
    let client: Client;
    let manager: PoolManager<OraclePoolLike>;
    let admin: Awaited<ReturnType<typeof oracledb.getConnection>>;
    let system: Awaited<ReturnType<typeof oracledb.getConnection>> | undefined;

    beforeAll(async () => {
        const config = loadConfig(process.env);
        admin = await oracledb.getConnection({
            connectString: config.connectString,
            password: config.password,
            user: config.user,
        });
        await runAll(admin, TEARDOWN);
        await runAll(admin, SETUP);
        await admin.commit();
        try {
            system = await oracledb.getConnection({
                connectString: config.connectString,
                password: process.env.ORACLE_ADMIN_PASSWORD ?? 'oracle',
                user: 'system',
            });
        } catch {
            system = undefined;
        }

        manager = new PoolManager({
            createPool: createOraclePool(config),
            log: (m) => process.stderr.write(`${m}\n`),
        });
        const executor = new OracleExecutor(manager, {
            maxRows: config.maxRows,
            readOnly: config.readOnly,
        });
        const server = createOracleServer({
            config,
            executor,
            poolState: (db) => manager.describe(db),
        });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        client = new Client({ name: 'integration', version: '0.0.0' });
        await client.connect(clientTransport);
    }, 120000);

    afterAll(async () => {
        await client?.close();
        await manager?.closeAll();
        if (admin) {
            await runAll(admin, TEARDOWN);
            await admin.close();
        }
        await system?.close();
    }, 60000);

    it('test_connection succeeds', async () => {
        const result = await client.callTool({ name: 'test_connection', arguments: {} });
        const parsed = JSON.parse(text(result));

        expect(result.isError).toBeFalsy();
        expect(parsed.ok).toBe(true);
        expect(parsed.pool.connected).toBe(true);
    }, 30000);

    it('get_server_info returns a version and the schema', async () => {
        const parsed = JSON.parse(
            text(await client.callTool({ name: 'get_server_info', arguments: {} })),
        );
        expect(parsed.version).toMatch(/^\d+\./);
        expect(parsed.login).toBe(process.env.ORACLE_USER?.toUpperCase());
    });

    it('list_databases lists the application schema and hides SYS', async () => {
        const parsed = JSON.parse(
            text(await client.callTool({ name: 'list_databases', arguments: {} })),
        );
        const names = parsed.rows.map((row: unknown[]) => row[0]);
        expect(names).toContain(process.env.ORACLE_USER?.toUpperCase());
        expect(names).not.toContain('SYS');
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
            'kind',
            'rowCount',
            'lastAnalyzed',
            'comment',
        ]);
        expect(tables.rows.map((row: unknown[]) => row[1])).toEqual(['IT_CUSTOMERS', 'IT_ORDERS']);
        expect(tables.rows[0][3]).toBe(50);
        expect(tables.rows[0][5]).toBe('People we invoice');

        const described = JSON.parse(
            text(
                await client.callTool({
                    name: 'describe_table',
                    arguments: { table: 'it_orders' },
                }),
            ),
        );
        expect(described.columns.map((c: { name: string }) => c.name)).toEqual([
            'ID',
            'CUSTOMER_ID',
            'TOTAL',
            'PLACED_ON',
            'NOTES',
        ]);
        expect(described.columns[2].type).toBe('NUMBER(12,2)');
        expect(described.columns[0].identity).toBe(1);
        expect(described.indexes.map((i: { name: string }) => i.name)).toContain(
            'IT_ORDERS_CUSTOMER_IDX',
        );
        expect(
            described.indexes.find((i: { is_primary_key: number }) => i.is_primary_key === 1),
        ).toBeDefined();
        expect(described.foreignKeys).toHaveLength(1);
        expect(described.foreignKeys[0]).toMatchObject({
            direction: 'outgoing',
            fromColumns: 'CUSTOMER_ID',
            onDelete: 'CASCADE',
            toTable: `${process.env.ORACLE_USER?.toUpperCase()}.IT_CUSTOMERS`,
        });

        const sample = await client.callTool({
            name: 'sample_data',
            arguments: { table: 'it_orders', limit: 2, columns: ['ID', 'TOTAL', 'NOTES'] },
        });
        expect(sample.isError).toBeFalsy();
        const parsed = JSON.parse(text(sample));
        expect(parsed.columns).toEqual(['ID', 'TOTAL', 'NOTES']);
        expect(parsed.rows).toHaveLength(2);
        expect(parsed.rows[0][2]).toBeNull();
    }, 60000);

    it('list_views, list_procedures, get_object_definition and search_objects find the fixtures', async () => {
        const views = JSON.parse(
            text(await client.callTool({ name: 'list_views', arguments: { nameContains: 'it_' } })),
        );
        expect(views.rows.map((row: unknown[]) => row[1])).toEqual(['IT_BIG_ORDERS']);

        const routines = JSON.parse(
            text(
                await client.callTool({
                    name: 'list_procedures',
                    arguments: { nameContains: 'it_' },
                }),
            ),
        );
        expect(routines.rows[0].slice(0, 4)).toEqual([
            process.env.ORACLE_USER?.toUpperCase(),
            'IT_ORDER_COUNT',
            'function',
            'VALID',
        ]);

        const viewDef = text(
            await client.callTool({
                name: 'get_object_definition',
                arguments: { name: 'it_big_orders' },
            }),
        );
        expect(viewDef).toMatch(/^-- view \w+\.IT_BIG_ORDERS/);
        expect(viewDef).toMatch(/total > 100/i);

        const fnDef = text(
            await client.callTool({
                name: 'get_object_definition',
                arguments: { name: 'it_order_count' },
            }),
        );
        expect(fnDef).toMatch(/^-- function/);
        expect(fnDef).toMatch(/return count|select count\(\*\) into n/i);

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
        expect(kinds).toContain('function');

        const columns = JSON.parse(
            text(
                await client.callTool({
                    name: 'search_objects',
                    arguments: { pattern: 'customer_', types: ['column'] },
                }),
            ),
        );
        expect(columns.rows.map((row: unknown[]) => row[2])).toEqual([
            'CUSTOMER_ID',
            'CUSTOMER_ID',
        ]);
    });

    it('get_foreign_keys and get_table_stats cover the schema', async () => {
        const fks = JSON.parse(
            text(
                await client.callTool({
                    name: 'get_foreign_keys',
                    arguments: { table: 'it_customers' },
                }),
            ),
        );
        expect(fks.rows).toHaveLength(1);

        const stats = JSON.parse(
            text(
                await client.callTool({
                    name: 'get_table_stats',
                    arguments: { table: 'it_orders' },
                }),
            ),
        );
        expect(stats.columns).toContain('dataKb');
        expect(stats.rows[0][2]).toBe(300);
        expect(stats.rows[0][5]).toBeGreaterThan(0);
    });

    it('execute_query binds parameters, caps rows and keeps column order', async () => {
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
        expect(parsed.columns).toEqual(['ID', 'TOTAL']);
        expect(parsed.rows).toHaveLength(5);
        expect(parsed.rows[0]).toEqual([2, 15]);
        expect(parsed.truncated).toBe(true);
    });

    it('execute_query runs a private temporary table batch in read-only mode on one session', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: {
                sql: `create private temporary table ora$ptt_totals as select customer_id, sum(total) as total from it_orders group by customer_id;
                      select count(*) as n from ora$ptt_totals`,
            },
        });
        const parsed = JSON.parse(text(result));

        expect(result.isError).toBeFalsy();
        expect(parsed.rows).toEqual([[50]]);
    });

    it('execute_query returns SQL errors with the ORA code', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'select 1 from no_such_table_xyz' },
        });

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/ORA-00942/);
    });

    it('read-only mode blocks writes without hitting the server', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: `insert into it_customers (name) values ('nope')` },
        });
        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/read-only/i);

        const count = await admin.execute('select count(*) from it_customers');
        expect((count.rows as unknown[][])[0]?.[0]).toBe(50);
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

    it('recovers after the server kills its session', async (context) => {
        if (!system) {
            context.skip();
            return;
        }
        const first = JSON.parse(
            text(
                await client.callTool({
                    name: 'execute_query',
                    arguments: { sql: `select sys_context('userenv', 'sid') as sid from dual` },
                }),
            ),
        );
        const sid = Number(first.rows[0][0]);
        const lookup = await system.execute(`select serial# from v$session where sid = :b_sid`, {
            b_sid: sid,
        });
        const serial = (lookup.rows as unknown[][])[0]?.[0];
        await system.execute(`alter system kill session '${sid},${serial}' immediate`);

        const second = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'select 1 as n from dual' },
        });
        expect(second.isError).toBeFalsy();
        expect(JSON.parse(text(second)).rows).toEqual([[1]]);
    }, 30000);
});
