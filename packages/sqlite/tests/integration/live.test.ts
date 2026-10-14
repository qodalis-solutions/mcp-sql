/**
 * Live test against a real SQLite file. It needs no service, so it is not
 * gated by RUN_INTEGRATION: it runs wherever `node:sqlite` is available
 * (Node >= 22.13). The file lives in a temp directory and is removed again.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, realpathSync, rmSync, statSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { PoolManager } from '@qodalis/mcp-sql-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../../src/config.js';
import { createSqliteServer } from '../../src/server.js';
import { SqliteExecutor } from '../../src/sql/executor.js';
import { createSqliteDatabase, type SqliteDatabase } from '../../src/sql/sqlite-db.js';

const text = (result: { content: unknown[] }): string =>
    (result.content[0] as { text: string }).text;

const SETUP_SQL = `
create table customers (
    id integer primary key,
    name text not null,
    created_at text not null default (datetime('now'))
);
create table orders (
    id integer primary key autoincrement,
    customer_id integer not null references customers (id) on delete cascade,
    total numeric(12, 2) not null,
    placed_on text not null default (date('now'))
);
create index orders_customer_idx on orders (customer_id);
create view big_orders as select * from orders where total > 100;
create trigger orders_audit after insert on orders begin update customers set name = name where id = new.customer_id; end;
with recursive seq(value) as (select 1 union all select value + 1 from seq where value < 50)
insert into customers (name) select 'customer ' || value from seq;
with recursive seq(value) as (select 1 union all select value + 1 from seq where value < 300)
insert into orders (customer_id, total) select ((value - 1) % 50) + 1, value * 7.5 from seq;
`;

const writeDb = (file: string, sql: string): void => {
    const db = new DatabaseSync(file);
    db.exec(sql);
    db.close();
};

const connect = async (config: Config) => {
    const manager = new PoolManager<SqliteDatabase>({ createPool: createSqliteDatabase(config) });
    const executor = new SqliteExecutor(manager, { maxRows: config.maxRows });
    const server = createSqliteServer({
        config,
        executor,
        poolState: (db) => manager.describe(db),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'integration', version: '0.0.0' });
    await client.connect(clientTransport);
    return { client, manager };
};

describe('live SQLite', () => {
    let dir: string;
    let file: string;
    let client: Client;
    let manager: PoolManager<SqliteDatabase>;

    beforeAll(async () => {
        // SQLite reports the real path of the file, so resolve the macOS /var -> /private/var symlink up front.
        dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'mcp-sqlite-live-')));
        file = path.join(dir, 'shop.db');
        writeDb(file, SETUP_SQL);
        ({ client, manager } = await connect(loadConfig({ SQLITE_DATABASE: file })));
    });

    afterAll(async () => {
        await client?.close();
        await manager?.closeAll();
        rmSync(dir, { recursive: true, force: true });
    });

    it('test_connection succeeds and reports the file', async () => {
        const result = await client.callTool({ name: 'test_connection', arguments: {} });
        const parsed = JSON.parse(text(result));

        expect(result.isError).toBeFalsy();
        expect(parsed.ok).toBe(true);
        expect(parsed.database).toBe(file);
        expect(parsed.pool.connected).toBe(true);
    });

    it('get_server_info returns the library version and file facts', async () => {
        const parsed = JSON.parse(
            text(await client.callTool({ name: 'get_server_info', arguments: {} })),
        );
        expect(parsed.version).toMatch(/^3\./);
        expect(parsed.file).toBe(file);
        expect(parsed.pageSize).toBeGreaterThan(0);
        expect(parsed.journalMode).toBe('delete');
    });

    it('list_databases shows main and the configured key', async () => {
        const parsed = JSON.parse(
            text(await client.callTool({ name: 'list_databases', arguments: {} })),
        );
        expect(parsed.attached.map((a: { name: string }) => a.name)).toContain('main');
        expect(parsed.configured).toEqual(['shop']);
        expect(parsed.current).toBe('shop');
    });

    it('list_tables, describe_table and sample_data work on a real table', async () => {
        const tables = JSON.parse(
            text(await client.callTool({ name: 'list_tables', arguments: {} })),
        );
        expect(tables.columns).toEqual(['schema', 'name', 'kind', 'columnCount', 'rowCount']);
        expect(tables.rows).toEqual([
            ['main', 'customers', 'table', 3, 50],
            ['main', 'orders', 'table', 4, 300],
        ]);

        const described = JSON.parse(
            text(await client.callTool({ name: 'describe_table', arguments: { table: 'orders' } })),
        );
        expect(described.columns.map((c: { name: string }) => c.name)).toEqual([
            'id',
            'customer_id',
            'total',
            'placed_on',
        ]);
        expect(described.columns[2]).toMatchObject({ type: 'numeric(12, 2)', nullable: false });
        expect(described.columns[0]).toMatchObject({ primaryKeyPosition: 1 });
        expect(described.indexes).toEqual([
            expect.objectContaining({
                name: 'orders_customer_idx',
                columns: 'customer_id',
                is_unique: false,
            }),
        ]);
        expect(described.foreignKeys).toEqual([
            expect.objectContaining({
                direction: 'outgoing',
                fromColumns: 'customer_id',
                toTable: 'customers',
                toColumns: 'id',
                onDelete: 'CASCADE',
            }),
        ]);

        const incoming = JSON.parse(
            text(
                await client.callTool({
                    name: 'describe_table',
                    arguments: { table: 'customers' },
                }),
            ),
        );
        expect(incoming.foreignKeys).toEqual([
            expect.objectContaining({ direction: 'incoming', fromTable: 'main.orders' }),
        ]);

        const sample = await client.callTool({
            name: 'sample_data',
            arguments: { table: 'orders', limit: 2, columns: ['id', 'total'] },
        });
        expect(sample.isError).toBeFalsy();
        const parsed = JSON.parse(text(sample));
        expect(parsed.columns).toEqual(['id', 'total']);
        expect(parsed.rows).toEqual([
            [1, 7.5],
            [2, 15],
        ]);
    });

    it('list_views, list_procedures, get_object_definition and search_objects find the fixtures', async () => {
        const views = JSON.parse(
            text(await client.callTool({ name: 'list_views', arguments: {} })),
        );
        expect(views.rows).toEqual([['main', 'big_orders', 4]]);

        const procedures = await client.callTool({ name: 'list_procedures', arguments: {} });
        expect(procedures.isError).toBeFalsy();
        expect(text(procedures)).toMatch(/no stored procedures/i);

        const viewDef = text(
            await client.callTool({
                name: 'get_object_definition',
                arguments: { name: 'big_orders' },
            }),
        );
        expect(viewDef).toMatch(/^-- view main\.big_orders/);
        expect(viewDef).toMatch(/total > 100/);

        const triggerDef = text(
            await client.callTool({
                name: 'get_object_definition',
                arguments: { name: 'orders_audit' },
            }),
        );
        expect(triggerDef).toMatch(/^-- trigger main\.orders_audit/);

        const search = JSON.parse(
            text(
                await client.callTool({ name: 'search_objects', arguments: { pattern: 'order' } }),
            ),
        );
        expect(search.rows).toEqual([
            ['index', 'main.orders_customer_idx', 'orders'],
            ['table', 'main.orders', null],
            ['trigger', 'main.orders_audit', 'orders'],
            ['view', 'main.big_orders', null],
        ]);

        const columns = JSON.parse(
            text(
                await client.callTool({
                    name: 'search_objects',
                    arguments: { pattern: 'customer_', types: ['column'] },
                }),
            ),
        );
        expect(columns.rows).toEqual([
            ['column', 'main.big_orders', 'customer_id'],
            ['column', 'main.orders', 'customer_id'],
        ]);
    });

    it('get_foreign_keys and get_table_stats cover the file', async () => {
        const fks = JSON.parse(
            text(
                await client.callTool({
                    name: 'get_foreign_keys',
                    arguments: { table: 'customers' },
                }),
            ),
        );
        expect(fks.rows).toEqual([
            ['main.orders', 'fk_0', 'customer_id', 'customers', 'id', 'NO ACTION', 'CASCADE'],
        ]);

        const all = JSON.parse(
            text(await client.callTool({ name: 'get_foreign_keys', arguments: {} })),
        );
        expect(all.rows).toHaveLength(1);

        const stats = JSON.parse(
            text(await client.callTool({ name: 'get_table_stats', arguments: {} })),
        );
        expect(stats.columns).toEqual(['schema', 'table', 'rowCount', 'sizeKb', 'indexCount']);
        expect(stats.rows[1]?.slice(0, 3)).toEqual(['main', 'orders', 300]);
        expect(stats.rows[1]?.[4]).toBe(1);
    });

    it('execute_query binds parameters, caps rows and keeps column order', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: {
                sql: 'select id, total from orders where total > @min order by id',
                params: { min: 10 },
                maxRows: 5,
            },
        });
        const parsed = JSON.parse(text(result));

        expect(result.isError).toBeFalsy();
        expect(parsed.columns).toEqual(['id', 'total']);
        expect(parsed.rows).toHaveLength(5);
        expect(parsed.rows[0]).toEqual([2, 15]);
        expect(parsed.truncated).toBe(true);
    });

    it('execute_query runs a multi-statement temp-table batch in read-only mode', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: {
                sql: `create temp table tmp_totals as select customer_id, sum(total) as total from orders group by customer_id;
                      select count(*) as n from tmp_totals;`,
            },
        });
        const parsed = JSON.parse(text(result));

        expect(result.isError).toBeFalsy();
        expect(parsed.rows).toEqual([[50]]);
    });

    it('execute_query returns SQL errors with the message', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'select 1 from no_such_table_xyz' },
        });

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/no such table: no_such_table_xyz/);
    });

    it('read-only mode blocks writes before they reach the file', async () => {
        const before = statSync(file).mtimeMs;
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: "insert into customers (name) values ('nope')" },
        });

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/read-only/i);
        expect(statSync(file).mtimeMs).toBe(before);
    });

    it('recovers after the file is replaced underneath it', async () => {
        unlinkSync(file);
        writeDb(file, 'create table replaced (a); insert into replaced values (42)');

        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'select a from replaced' },
        });

        expect(result.isError).toBeFalsy();
        expect(JSON.parse(text(result)).rows).toEqual([[42]]);
    });

    it('fails with the path while the file is missing and recovers once it is back', async () => {
        unlinkSync(file);
        const missing = await client.callTool({ name: 'test_connection', arguments: {} });
        expect(JSON.parse(text(missing)).ok).toBe(false);
        expect(text(missing)).toContain('shop.db');

        writeDb(file, SETUP_SQL);
        const back = JSON.parse(
            text(await client.callTool({ name: 'test_connection', arguments: {} })),
        );
        expect(back.ok).toBe(true);
    });
});

describe('live SQLite in memory', () => {
    it('serves an in-memory database with the guard still applied', async () => {
        const { client, manager } = await connect(loadConfig({ SQLITE_DATABASE: ':memory:' }));
        try {
            const created = await client.callTool({
                name: 'execute_query',
                arguments: {
                    sql: "create temp table notes (body); insert into notes values ('hi'); select body from notes",
                },
            });
            expect(JSON.parse(text(created)).rows).toEqual([['hi']]);

            const blocked = await client.callTool({
                name: 'execute_query',
                arguments: { sql: 'create table persistent (a)' },
            });
            expect(blocked.isError).toBe(true);

            const info = JSON.parse(
                text(await client.callTool({ name: 'test_connection', arguments: {} })),
            );
            expect(info.ok).toBe(true);
            expect(info.database).toBe('');
        } finally {
            await client.close();
            await manager.closeAll();
        }
    });
});
