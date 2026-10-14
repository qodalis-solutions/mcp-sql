import { describe, expect, it } from 'vitest';
import { resolveDatabase, runTool } from '../../../src/tools/context.js';
import type { ToolDefinition } from '../../../src/tools/context.js';
import { z } from 'zod';
import { makeContext as makeCoreContext } from '../../../src/testing/index.js';
import { testDialect } from '../test-dialect.js';

const makeContext = (overrides = {}) => makeCoreContext(testDialect, overrides);

describe('resolveDatabase', () => {
    it('returns the default database when none is requested', () => {
        expect(resolveDatabase(makeContext(), undefined)).toBe('Sales');
    });

    it('returns a requested database that is on the allowlist', () => {
        expect(resolveDatabase(makeContext(), 'Archive')).toBe('Archive');
    });

    it('matches allowlisted names case-insensitively, returning the configured spelling', () => {
        expect(resolveDatabase(makeContext(), 'archive')).toBe('Archive');
    });

    it('rejects a database outside the allowlist and names the allowed ones', () => {
        expect(() => resolveDatabase(makeContext(), 'master')).toThrow(/Sales, Archive/);
    });

    it('allows any database when no allowlist is configured', () => {
        const ctx = makeContext({
            config: { ...makeContext().config, allowedDatabases: [], database: undefined },
        });

        expect(resolveDatabase(ctx, 'anything')).toBe('anything');
        expect(resolveDatabase(ctx, undefined)).toBeUndefined();
    });
});

describe('runTool', () => {
    const tool: ToolDefinition<z.ZodObject<{ fail: z.ZodOptional<z.ZodBoolean> }>> = {
        name: 'demo',
        title: 'Demo',
        description: 'd',
        inputSchema: z.object({ fail: z.boolean().optional() }),
        annotations: { readOnlyHint: true },
        handler: async (args) => {
            if (args.fail) {
                throw Object.assign(new Error('bad thing with p@ss inside'), {
                    code: 'EREQUEST',
                    number: 208,
                });
            }
            return { text: 'fine', structured: { ok: true } };
        },
    };

    it('returns the handler output as a text content block with structured content', async () => {
        const result = await runTool(tool, { fail: false }, makeContext());

        expect(result.isError).toBeFalsy();
        expect(result.content).toEqual([{ type: 'text', text: 'fine' }]);
        expect(result.structuredContent).toEqual({ ok: true });
    });

    it('turns thrown errors into an isError result with a redacted public message', async () => {
        const result = await runTool(tool, { fail: true }, makeContext());

        expect(result.isError).toBe(true);
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('EREQUEST');
        expect(text).toContain('208');
        expect(text).toContain('[redacted]');
        expect(text).not.toContain('p@ss');
    });

    it('explains connection failures in terms the user can act on', async () => {
        const ctx = makeContext();
        ctx.executor.failWith = Object.assign(
            new Error('Failed to connect to db.example.com:1433 in 8000ms'),
            { code: 'ETIMEOUT' },
        );
        const connectionTool: ToolDefinition<z.ZodObject<Record<string, never>>> = {
            ...tool,
            inputSchema: z.object({}),
            handler: async (_args, context) => {
                await context.executor.run({ sql: 'select 1' });
                return { text: 'unreachable' };
            },
        };

        const result = await runTool(connectionTool, {}, ctx);

        expect(result.isError).toBe(true);
        const text = (result.content[0] as { text: string }).text;
        expect(text).toMatch(/VPN|network|reachable/i);
        expect(text).toMatch(/retry/i);
    });
});
