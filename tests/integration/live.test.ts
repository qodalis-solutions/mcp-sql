/**
 * Live integration test. Runs only when RUN_INTEGRATION=1 and SQLSERVER_* point
 * at a reachable SQL Server. Everything it does is read-only.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createServer } from '../../src/server.js';
import { SqlExecutor } from '../../src/sql/executor.js';
import { createMssqlPool } from '../../src/sql/mssql-pool.js';
import { PoolManager } from '../../src/sql/pool-manager.js';
import type { QueryPoolLike } from '../../src/sql/executor.js';

const enabled = process.env.RUN_INTEGRATION === '1' && Boolean(process.env.SQLSERVER_HOST);

const text = (result: { content: unknown[] }): string =>
    (result.content[0] as { text: string }).text;

describe.skipIf(!enabled)('live SQL Server', () => {
    let client: Client;
    let manager: PoolManager<QueryPoolLike>;

    beforeAll(async () => {
        const config = loadConfig(process.env);
        manager = new PoolManager({
            createPool: createMssqlPool(config),
            log: (m) => process.stderr.write(`${m}\n`),
        });
        const executor = new SqlExecutor(manager, { maxRows: config.maxRows });
        const server = createServer({ config, executor, poolState: (db) => manager.describe(db) });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        client = new Client({ name: 'integration', version: '0.0.0' });
        await client.connect(clientTransport);
    }, 30000);

    afterAll(async () => {
        await client?.close();
        await manager?.closeAll();
    });

    it('test_connection succeeds', async () => {
        const result = await client.callTool({ name: 'test_connection', arguments: {} });
        const parsed = JSON.parse(text(result));

        expect(result.isError).toBeFalsy();
        expect(parsed.ok).toBe(true);
        expect(parsed.pool.connected).toBe(true);
    }, 30000);

    it('get_server_info returns a product version', async () => {
        const parsed = JSON.parse(
            text(await client.callTool({ name: 'get_server_info', arguments: {} })),
        );
        expect(parsed.productVersion).toMatch(/^\d+\./);
    });

    it('list_tables, describe_table and sample_data work on a real table', async () => {
        const tables = JSON.parse(
            text(
                await client.callTool({
                    name: 'list_tables',
                    arguments: { includeRowCounts: true },
                }),
            ),
        );
        expect(tables.columns).toEqual(['schema', 'name', 'rowCount', 'createDate', 'modifyDate']);
        expect(tables.rows.length).toBeGreaterThan(0);

        const [schema, name] = tables.rows[0] as [string, string];
        const described = JSON.parse(
            text(
                await client.callTool({
                    name: 'describe_table',
                    arguments: { table: `${schema}.${name}` },
                }),
            ),
        );
        expect(described.columns.length).toBeGreaterThan(0);
        expect(described.columns[0]).toHaveProperty('type');

        const sample = await client.callTool({
            name: 'sample_data',
            arguments: { table: `${schema}.${name}`, limit: 2 },
        });
        expect(sample.isError).toBeFalsy();
        expect(JSON.parse(text(sample)).rows.length).toBeLessThanOrEqual(2);
    }, 60000);

    it('execute_query binds parameters and caps rows', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: {
                sql: 'select top 50 object_id, name from sys.objects where name like @p order by name',
                params: { p: '%' },
                maxRows: 5,
            },
        });
        const parsed = JSON.parse(text(result));

        expect(result.isError).toBeFalsy();
        expect(parsed.columns).toEqual(['object_id', 'name']);
        expect(parsed.rows).toHaveLength(5);
        expect(parsed.truncated).toBe(true);
    });

    it('execute_query returns SQL errors with code and line', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'select 1\nfrom NoSuchTable_xyz' },
        });

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/EREQUEST/);
        expect(text(result)).toMatch(/NoSuchTable_xyz/);
    });

    it('read-only mode blocks writes without hitting the server', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'create table dbo.__mcp_should_not_exist (a int)' },
        });
        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/read-only/i);
    });

    it('search_objects and get_foreign_keys answer within the row cap', async () => {
        const search = JSON.parse(
            text(
                await client.callTool({
                    name: 'search_objects',
                    arguments: { pattern: 'a', limit: 3 },
                }),
            ),
        );
        expect(search.rows.length).toBeLessThanOrEqual(3);

        const fks = await client.callTool({ name: 'get_foreign_keys', arguments: {} });
        expect(fks.isError).toBeFalsy();
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
});
