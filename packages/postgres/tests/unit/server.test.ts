import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    FakeExecutor,
    makeContext as makeCoreContext,
    tableResult,
} from '@qodalis/mcp-sql-core/testing';
import { postgresDialect } from '../../src/dialect.js';
import { createPostgresServer, TOOL_NAMES } from '../../src/server.js';

describe('createPostgresServer', () => {
    let client: Client;
    let executor: FakeExecutor;

    beforeEach(async () => {
        const context = makeCoreContext(postgresDialect);
        executor = context.executor;
        const server = createPostgresServer({
            config: context.config,
            executor,
            poolState: context.poolState,
        });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        client = new Client({ name: 'test-client', version: '0.0.0' });
        await client.connect(clientTransport);
    });

    afterEach(async () => {
        await client.close();
    });

    it('exposes the same thirteen tool names as the SQL Server package', async () => {
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name).sort();

        expect(names).toEqual([...TOOL_NAMES].sort());
        expect(names).toEqual([
            'describe_table',
            'execute_query',
            'get_foreign_keys',
            'get_object_definition',
            'get_server_info',
            'get_table_stats',
            'list_databases',
            'list_procedures',
            'list_tables',
            'list_views',
            'sample_data',
            'search_objects',
            'test_connection',
        ]);
    });

    it('names itself and mentions PostgreSQL in the instructions', () => {
        expect(client.getServerVersion()?.name).toBe('@qodalis/mcp-postgres');
        expect(client.getInstructions()).toContain('PostgreSQL');
    });

    it('runs execute_query end to end', async () => {
        executor.queue = [tableResult(['n'], [[1]])];
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'select 1 as n' },
        });
        expect(result.isError).toBeFalsy();
    });
});
