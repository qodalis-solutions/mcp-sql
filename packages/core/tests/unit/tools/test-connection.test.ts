import { describe, expect, it } from 'vitest';
import { runTool } from '../../../src/tools/context.js';
import { testConnectionTool } from '../../../src/tools/test-connection.js';
import {
    makeContext as makeCoreContext,
    resultText,
    tableResult,
} from '../../../src/testing/index.js';
import { testDialect } from '../test-dialect.js';

const makeContext = () => makeCoreContext(testDialect);

describe('test_connection', () => {
    it('runs the dialect probe and reports connection details plus pool state', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [
            tableResult(['database', 'login', 'serverTime'], [['Sales', 'reader', '2026-01-01']]),
        ];

        const result = await runTool(testConnectionTool, {}, ctx);
        const parsed = JSON.parse(resultText(result));

        expect(ctx.executor.lastSql).toBe(testDialect.probeSql);
        expect(parsed).toMatchObject({
            ok: true,
            dialect: 'test',
            database: 'Sales',
            login: 'reader',
            readOnly: true,
            server: 'db.example.com',
            pool: { connected: true, connecting: false },
        });
        expect(typeof parsed.durationMs).toBe('number');
    });

    it('returns ok=false with the cause and a VPN hint instead of throwing when unreachable', async () => {
        const ctx = makeContext();
        ctx.executor.failWith = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), {
            code: 'ECONNREFUSED',
        });

        const result = await runTool(testConnectionTool, {}, ctx);
        const parsed = JSON.parse(resultText(result));

        expect(result.isError).toBe(true);
        expect(parsed.ok).toBe(false);
        expect(parsed.error.code).toBe('ECONNREFUSED');
        expect(parsed.hint).toMatch(/VPN|network/i);
    });

    it('distinguishes a rejected request from an unreachable host', async () => {
        const ctx = makeContext();
        ctx.executor.failWith = Object.assign(new Error('permission denied'), { code: '42501' });

        const parsed = JSON.parse(resultText(await runTool(testConnectionTool, {}, ctx)));

        expect(parsed.ok).toBe(false);
        expect(parsed.hint).toMatch(/credentials|permissions/i);
    });
});
