import { describe, expect, it } from 'vitest';
import { runTool } from '@qodalis/mcp-sql-core';
import { getServerInfoTool } from '../../../src/tools/get-server-info.js';
import { makeContext as makeCoreContext, tableResult } from '@qodalis/mcp-sql-core/testing';
import { sqlserverDialect } from '../../../src/dialect.js';

const makeContext = (overrides = {}) => makeCoreContext(sqlserverDialect, overrides);

const text = (result: { content: unknown[] }): string =>
    (result.content[0] as { text: string }).text;

describe('get_server_info', () => {
    it('reads SERVERPROPERTY values and the current database', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [
            tableResult(['productVersion', 'edition'], [['16.0.4', 'Enterprise']]),
        ];

        const result = await runTool(getServerInfoTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/SERVERPROPERTY/);
        expect(JSON.parse(text(result))).toMatchObject({
            productVersion: '16.0.4',
            edition: 'Enterprise',
        });
    });
});
