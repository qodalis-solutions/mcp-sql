import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../../src/server.js';
import { executeQueryTool } from '../../src/tools/execute-query.js';
import { testConnectionTool } from '../../src/tools/test-connection.js';
import { FakeExecutor, makeContext, tableResult } from '../../src/testing/index.js';
import { testDialect } from './test-dialect.js';

describe('createServer (generic, in-memory transport)', () => {
    let client: Client;
    let executor: FakeExecutor;

    beforeEach(async () => {
        const context = makeContext(testDialect);
        executor = context.executor;
        const server = createServer({
            config: context.config,
            dialect: testDialect,
            executor,
            name: 'test-server',
            poolState: context.poolState,
            tools: [testConnectionTool, executeQueryTool],
            version: '9.9.9',
        });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        client = new Client({ name: 'test-client', version: '0.0.0' });
        await client.connect(clientTransport);
    });

    afterEach(async () => {
        await client.close();
    });

    it('advertises exactly the tools it was given', async () => {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual(['execute_query', 'test_connection']);
    });

    it('reports its name and version', () => {
        expect(client.getServerVersion()).toMatchObject({ name: 'test-server', version: '9.9.9' });
    });

    it('mentions the dialect, read-only mode and reconnection in its instructions', () => {
        const instructions = client.getInstructions() ?? '';
        expect(instructions).toContain('Test SQL');
        expect(instructions).toMatch(/read-only/i);
        expect(instructions).toMatch(/reconnect/i);
    });

    it('runs a tool end to end', async () => {
        executor.queue = [tableResult(['n'], [[1]])];
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'select 1 as n' },
        });
        expect(result.isError).toBeFalsy();
        expect(executor.calls[0]?.sql).toBe('select 1 as n');
    });

    it('turns a blocked statement into an isError result, not a protocol error', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'drop table t' },
        });
        expect(result.isError).toBe(true);
        expect(executor.calls).toHaveLength(0);
    });
});
