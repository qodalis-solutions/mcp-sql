import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqlServerServer, TOOL_NAMES } from '../../src/server.js';
import {
    FakeExecutor,
    makeContext as makeCoreContext,
    tableResult,
} from '@qodalis/mcp-sql-core/testing';
import { sqlserverDialect } from '../../src/dialect.js';

const makeContext = () => makeCoreContext(sqlserverDialect);

describe('createServer (end to end over an in-memory transport)', () => {
    let client: Client;
    let executor: FakeExecutor;

    beforeEach(async () => {
        const context = makeContext();
        executor = context.executor;
        const server = createSqlServerServer({
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

    it('advertises every tool with a description and input schema', async () => {
        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name).sort();

        expect(names).toEqual([...TOOL_NAMES].sort());
        expect(names).toContain('execute_query');
        expect(names).toContain('describe_table');
        expect(tools.every((tool) => tool.description && tool.inputSchema)).toBe(true);
    });

    it('marks catalog tools read-only and execute_query as potentially destructive', async () => {
        const { tools } = await client.listTools();
        const byName = new Map(tools.map((tool) => [tool.name, tool]));

        expect(byName.get('list_tables')?.annotations?.readOnlyHint).toBe(true);
        expect(byName.get('execute_query')?.annotations?.readOnlyHint).toBe(false);
    });

    it('executes a query through the executor and returns compact JSON', async () => {
        executor.queue = [tableResult(['n'], [[1]])];

        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'select 1 as n' },
        });
        const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';

        expect(result.isError).toBeFalsy();
        expect(JSON.parse(text)).toMatchObject({ columns: ['n'], rows: [[1]] });
        expect(executor.calls[0]?.sql).toBe('select 1 as n');
    });

    it('returns an isError result rather than a protocol error for a blocked statement', async () => {
        const result = await client.callTool({
            name: 'execute_query',
            arguments: { sql: 'drop table T' },
        });

        expect(result.isError).toBe(true);
        expect(executor.calls).toHaveLength(0);
    });

    it('reports invalid arguments as an error result naming the field', async () => {
        const result = await client.callTool({ name: 'sample_data', arguments: { limit: 'ten' } });
        const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';

        expect(result.isError).toBe(true);
        expect(text).toContain('limit');
        expect(executor.calls).toHaveLength(0);
    });

    it('publishes server instructions that explain read-only mode and reconnection', async () => {
        const instructions = client.getInstructions();

        expect(instructions).toMatch(/read-only/i);
        expect(instructions).toMatch(/reconnect/i);
    });
});
