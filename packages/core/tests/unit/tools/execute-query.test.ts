import { describe, expect, it } from 'vitest';
import { executeQueryTool } from '../../../src/tools/execute-query.js';
import { runTool } from '../../../src/tools/context.js';
import { makeContext as makeCoreContext, tableResult } from '../../../src/testing/index.js';
import { testDialect } from '../test-dialect.js';

const makeContext = (overrides = {}) => makeCoreContext(testDialect, overrides);

const text = (result: { content: unknown[] }): string =>
    (result.content[0] as { text: string }).text;

describe('execute_query', () => {
    it('runs a read query and returns compact JSON by default', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [tableResult(['Id'], [[1], [2]])];

        const result = await runTool(executeQueryTool, { sql: 'select Id from T' }, ctx);

        expect(result.isError).toBeFalsy();
        expect(JSON.parse(text(result))).toMatchObject({
            columns: ['Id'],
            rows: [[1], [2]],
            rowCount: 2,
        });
        expect(ctx.executor.calls[0]).toMatchObject({ sql: 'select Id from T', database: 'Sales' });
    });

    it('rejects writes in read-only mode before touching the database', async () => {
        const ctx = makeContext();

        const result = await runTool(executeQueryTool, { sql: 'delete from T' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/read-only/i);
        expect(text(result)).toContain('TEST_READ_ONLY=false');
        expect(ctx.executor.calls).toHaveLength(0);
    });

    it('allows writes when read-only mode is off', async () => {
        const ctx = makeContext({ config: { ...makeContext().config, readOnly: false } });

        const result = await runTool(executeQueryTool, { sql: 'update T set a = 1' }, ctx);

        expect(result.isError).toBeFalsy();
        expect(ctx.executor.calls).toHaveLength(1);
    });

    it('passes parameters, database and a per-call row cap through', async () => {
        const ctx = makeContext();

        await runTool(
            executeQueryTool,
            {
                sql: 'select * from T where Id = @id',
                params: { id: 3 },
                database: 'Archive',
                maxRows: 5,
            },
            ctx,
        );

        expect(ctx.executor.calls[0]).toMatchObject({
            params: { id: 3 },
            database: 'Archive',
            maxRows: 5,
        });
    });

    it('never raises the row cap above the configured maximum', async () => {
        const ctx = makeContext();

        await runTool(executeQueryTool, { sql: 'select 1', maxRows: 999999 }, ctx);

        expect(ctx.executor.calls[0]?.maxRows).toBe(1000);
    });

    it('renders markdown and csv on request', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [tableResult(['Id'], [[1]]), tableResult(['Id'], [[1]])];

        const md = await runTool(executeQueryTool, { sql: 'select 1', format: 'markdown' }, ctx);
        const csv = await runTool(executeQueryTool, { sql: 'select 1', format: 'csv' }, ctx);

        expect(text(md)).toContain('| Id |');
        expect(text(csv).split('\n')[0]).toBe('Id');
    });

    it('refuses a database that is not allowlisted', async () => {
        const ctx = makeContext();

        const result = await runTool(
            executeQueryTool,
            { sql: 'select 1', database: 'master' },
            ctx,
        );

        expect(result.isError).toBe(true);
        expect(ctx.executor.calls).toHaveLength(0);
    });

    it('surfaces SQL errors with their code and line', async () => {
        const ctx = makeContext();
        ctx.executor.failWith = Object.assign(new Error("Invalid column name 'x'."), {
            code: 'EREQUEST',
            lineNumber: 2,
        });

        const result = await runTool(executeQueryTool, { sql: 'select x from T' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toContain("Invalid column name 'x'.");
        expect(text(result)).toContain('line 2');
    });
});
