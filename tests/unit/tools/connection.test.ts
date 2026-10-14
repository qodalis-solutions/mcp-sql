import { describe, expect, it } from 'vitest';
import { runTool } from '../../../src/tools/context.js';
import { testConnectionTool } from '../../../src/tools/test-connection.js';
import { getServerInfoTool } from '../../../src/tools/get-server-info.js';
import { makeContext, tableResult } from '../../helpers/fake-executor.js';

const text = (result: { content: unknown[] }): string =>
    (result.content[0] as { text: string }).text;

describe('test_connection', () => {
    it('proves the connection by running a real query and reports pool state', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [
            tableResult(['database', 'login', 'serverTime'], [['Sales', 'reader', '2026-01-01']]),
        ];

        const result = await runTool(testConnectionTool, {}, ctx);
        const parsed = JSON.parse(text(result));

        expect(parsed.ok).toBe(true);
        expect(parsed.database).toBe('Sales');
        expect(parsed.login).toBe('reader');
        expect(parsed.readOnly).toBe(true);
        expect(parsed.pool).toEqual({ connected: true, connecting: false });
        expect(parsed.server).toBe('db.example.com');
        expect(typeof parsed.durationMs).toBe('number');
    });

    it('returns ok=false with the cause instead of throwing when the database is unreachable', async () => {
        const ctx = makeContext();
        ctx.executor.failWith = Object.assign(
            new Error('Failed to connect to db.example.com:1433 in 8000ms'),
            { code: 'ETIMEOUT' },
        );

        const result = await runTool(testConnectionTool, {}, ctx);
        const parsed = JSON.parse(text(result));

        expect(result.isError).toBe(true);
        expect(parsed.ok).toBe(false);
        expect(parsed.error.code).toBe('ETIMEOUT');
        expect(parsed.hint).toMatch(/VPN|network/i);
    });
});

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
