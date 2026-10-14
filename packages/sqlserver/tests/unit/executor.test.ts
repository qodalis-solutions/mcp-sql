import { describe, expect, it } from 'vitest';
import { PoolManager } from '@qodalis/mcp-sql-core';
import { SqlExecutor } from '../../src/sql/executor.js';
import { FakeQueryPool, type Script } from '../helpers/fake-query-pool.js';

const setup = (scripts: Script[]) => {
    const pools: FakeQueryPool[] = [];
    const manager = new PoolManager<FakeQueryPool>({
        createPool: (database) => {
            const pool = new FakeQueryPool(database);
            pool.scripts = scripts;
            pools.push(pool);
            return pool;
        },
    });
    const executor = new SqlExecutor(manager, { maxRows: 1000 });
    return { executor, pools };
};

const twoColumns = [
    { name: 'Id', type: 'int', nullable: false },
    { name: 'Name', type: 'nvarchar(50)' },
];

describe('SqlExecutor.run', () => {
    it('returns column metadata and rows as arrays in column order', async () => {
        const { executor } = setup([
            {
                columns: twoColumns,
                rows: [
                    { Id: 1, Name: 'a' },
                    { Id: 2, Name: 'b' },
                ],
                rowsAffected: [2],
            },
        ]);

        const result = await executor.run({ sql: 'select Id, Name from T' });

        expect(result.columns).toEqual([
            { name: 'Id', type: 'int', nullable: false },
            { name: 'Name', type: 'nvarchar(50)', nullable: true },
        ]);
        expect(result.rows).toEqual([
            [1, 'a'],
            [2, 'b'],
        ]);
        expect(result.rowCount).toBe(2);
        expect(result.truncated).toBe(false);
        expect(result.rowsAffected).toEqual([2]);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('accepts rows that already arrive as arrays', async () => {
        const { executor } = setup([{ columns: twoColumns, rows: [[1, 'a']] }]);

        const result = await executor.run({ sql: 'select 1' });

        expect(result.rows).toEqual([[1, 'a']]);
    });

    it('stops at maxRows, marks the result truncated and cancels the request', async () => {
        const rows = Array.from({ length: 10 }, (_, i) => ({ Id: i, Name: `n${i}` }));
        const { executor, pools } = setup([{ columns: twoColumns, rows, slow: true }]);

        const result = await executor.run({ sql: 'select * from T', maxRows: 3 });

        expect(result.rows).toHaveLength(3);
        expect(result.truncated).toBe(true);
        expect(pools[0]?.requests[0]?.cancelled).toBe(true);
    });

    it('uses the configured default maxRows when none is given per call', async () => {
        const rows = Array.from({ length: 5 }, (_, i) => ({ Id: i, Name: '' }));
        const pool = new FakeQueryPool('X');
        pool.scripts = [{ columns: twoColumns, rows }];
        const manager = new PoolManager<FakeQueryPool>({ createPool: () => pool });
        const executor = new SqlExecutor(manager, { maxRows: 2 });

        const result = await executor.run({ sql: 'select 1' });

        expect(result.rows).toHaveLength(2);
        expect(result.truncated).toBe(true);
    });

    it('binds named parameters on the request', async () => {
        const { executor, pools } = setup([{ columns: twoColumns, rows: [] }]);

        await executor.run({
            sql: 'select * from T where Id = @id and Name = @name',
            params: { id: 7, name: 'x' },
        });

        expect(pools[0]?.requests[0]?.inputs).toEqual([
            { name: 'id', value: 7 },
            { name: 'name', value: 'x' },
        ]);
    });

    it('enables streaming on the request so large results never buffer fully', async () => {
        const { executor, pools } = setup([{ columns: twoColumns, rows: [] }]);

        await executor.run({ sql: 'select 1' });

        expect(pools[0]?.requests[0]?.stream).toBe(true);
    });

    it('cancels the request and rejects when the abort signal fires', async () => {
        const rows = Array.from({ length: 50 }, (_, i) => ({ Id: i, Name: '' }));
        const { executor, pools } = setup([{ columns: twoColumns, rows, slow: true }]);
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5);

        await expect(executor.run({ sql: 'select 1', signal: controller.signal })).rejects.toThrow(
            /abort/i,
        );
        expect(pools[0]?.requests[0]?.cancelled).toBe(true);
    });

    it('propagates SQL errors untouched', async () => {
        const error = Object.assign(new Error("Invalid object name 'Nope'."), { code: 'EREQUEST' });
        const { executor, pools } = setup([{ error }]);

        await expect(executor.run({ sql: 'select * from Nope' })).rejects.toBe(error);
        expect(pools).toHaveLength(1);
    });

    it('retries once on a connection error with a fresh pool', async () => {
        const dropped = Object.assign(new Error('Connection lost - read ECONNRESET'), {
            code: 'ESOCKET',
        });
        const scripts: Script[] = [
            { error: dropped },
            { columns: twoColumns, rows: [{ Id: 1, Name: 'ok' }] },
        ];
        const { executor, pools } = setup(scripts);

        const result = await executor.run({ sql: 'select 1' });

        expect(result.rows).toEqual([[1, 'ok']]);
        expect(pools).toHaveLength(2);
    });

    it('collects informational messages such as PRINT output', async () => {
        const { executor } = setup([
            { columns: [], rows: [], messages: ['hello', 'world'], rowsAffected: [1] },
        ]);

        const result = await executor.run({ sql: "print 'hello'" });

        expect(result.messages).toEqual(['hello', 'world']);
        expect(result.columns).toEqual([]);
        expect(result.rowsAffected).toEqual([1]);
    });

    it('routes to the requested database', async () => {
        const { executor, pools } = setup([
            { columns: [], rows: [] },
            { columns: [], rows: [] },
        ]);

        await executor.run({ sql: 'select 1', database: 'Archive' });

        expect(pools[0]?.database).toBe('Archive');
    });
});
