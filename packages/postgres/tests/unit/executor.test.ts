import { describe, expect, it } from 'vitest';
import { PoolManager } from '@qodalis/mcp-sql-core';
import { PgExecutor } from '../../src/sql/executor.js';
import { FakePgPool, type Script } from '../helpers/fake-pg.js';

const INT4 = 23;
const TEXT = 25;

const setup = (scripts: Script[], maxRows = 1000, closeTimeoutMs = 50) => {
    const pools: FakePgPool[] = [];
    const manager = new PoolManager<FakePgPool>({
        createPool: (database) => {
            const pool = new FakePgPool(database);
            pool.scripts = scripts;
            pools.push(pool);
            return pool;
        },
    });
    return { executor: new PgExecutor(manager, { closeTimeoutMs, maxRows }), pools };
};

const twoFields = [
    { name: 'id', dataTypeID: INT4 },
    { name: 'name', dataTypeID: TEXT },
];

describe('PgExecutor.run', () => {
    it('returns typed columns and rows as arrays in field order', async () => {
        const { executor } = setup([
            {
                fields: twoFields,
                rows: [
                    [1, 'a'],
                    [2, 'b'],
                ],
            },
        ]);

        const result = await executor.run({ sql: 'select id, name from t' });

        expect(result.columns).toEqual([
            { name: 'id', type: 'integer', nullable: true },
            { name: 'name', type: 'text', nullable: true },
        ]);
        expect(result.rows).toEqual([
            [1, 'a'],
            [2, 'b'],
        ]);
        expect(result.rowCount).toBe(2);
        expect(result.truncated).toBe(false);
    });

    it('reads through a cursor in batches and stops at maxRows, closing the cursor', async () => {
        const rows = Array.from({ length: 10 }, (_, i) => [i, `n${i}`]);
        const { executor, pools } = setup([{ fields: twoFields, rows }]);

        const result = await executor.run({ sql: 'select * from t', maxRows: 3 });

        expect(result.rows).toHaveLength(3);
        expect(result.truncated).toBe(true);
        expect(pools[0]?.createdCursors[0]?.closed).toBe(true);
        expect(pools[0]?.clients[0]?.released).toBe(false);
    });

    it('rewrites @name params to $n and passes the values to the cursor', async () => {
        const { executor, pools } = setup([{ fields: twoFields, rows: [] }]);
        const pool = await (async () => {
            await executor.run({
                sql: 'select * from t where id = @id and name = @name',
                params: { id: 7, name: 'x' },
            });
            return pools[0]!;
        })();

        expect(pool.lastCursorSql).toBe('select * from t where id = $1 and name = $2');
        expect(pool.lastCursorValues).toEqual([7, 'x']);
    });

    it('uses the simple protocol for multi-statement batches without params', async () => {
        const batch: Script = {
            simple: [
                { command: 'CREATE', rowCount: null, rows: [], fields: [] },
                { command: 'INSERT', rowCount: 2, rows: [], fields: [] },
                {
                    command: 'SELECT',
                    rowCount: 1,
                    rows: [{ n: 1 }],
                    fields: [{ name: 'n', dataTypeID: INT4 }],
                },
            ],
        };
        const { executor, pools } = setup([batch]);

        const result = await executor.run({
            sql: 'create temp table tmp_a (n int); insert into tmp_a values (1),(2); select n from tmp_a',
        });

        expect(pools[0]?.clients[0]?.simpleQueries).toHaveLength(1);
        expect(result.columns).toEqual([{ name: 'n', type: 'integer', nullable: true }]);
        expect(result.rows).toEqual([[1]]);
        expect(result.rowsAffected).toEqual([2]);
    });

    it('rejects params together with a multi-statement batch with a clear message', async () => {
        const { executor } = setup([{}]);

        await expect(
            executor.run({ sql: 'select 1; select @a', params: { a: 1 } }),
        ).rejects.toThrow(/single statement/i);
    });

    it('reports rowsAffected for a command without a result set', async () => {
        const { executor } = setup([{ fields: [], rows: [], rowCount: 4, command: 'UPDATE' }]);

        const result = await executor.run({ sql: 'update t set a = 1' });

        expect(result.columns).toEqual([]);
        expect(result.rowsAffected).toEqual([4]);
    });

    it('collects RAISE NOTICE messages', async () => {
        const { executor } = setup([{ fields: [], rows: [], notices: ['hello'] }]);

        const result = await executor.run({ sql: 'select 1' });

        expect(result.messages).toEqual(['hello']);
    });

    it('propagates SQL errors untouched and releases the client normally', async () => {
        const error = Object.assign(new Error('relation "nope" does not exist'), { code: '42P01' });
        const { executor, pools } = setup([{ error }]);

        await expect(executor.run({ sql: 'select * from nope' })).rejects.toBe(error);
        expect(pools[0]?.clients[0]?.released).toBe(false);
        expect(pools).toHaveLength(1);
    });

    it('retries once on a connection error with a fresh pool', async () => {
        const dropped = Object.assign(new Error('Connection terminated unexpectedly'), {
            code: 'ECONNRESET',
        });
        const { executor, pools } = setup([
            { error: dropped },
            { fields: twoFields, rows: [[1, 'ok']] },
        ]);

        const result = await executor.run({ sql: 'select 1' });

        expect(result.rows).toEqual([[1, 'ok']]);
        expect(pools).toHaveLength(2);
    });

    it('destroys the client and rejects when the abort signal fires', async () => {
        const rows = Array.from({ length: 500 }, (_, i) => [i, '']);
        const { executor, pools } = setup([{ fields: twoFields, readDelayMs: 20, rows }]);
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5);

        await expect(
            executor.run({ sql: 'select 1', signal: controller.signal, maxRows: 100000 }),
        ).rejects.toThrow(/abort/i);
        expect(pools[0]?.clients[0]?.released).toBe(true);
    });

    it('settles a connection error without waiting for the portal close and destroys the client', async () => {
        const dropped = Object.assign(new Error('Connection terminated unexpectedly'), {
            closeHangs: true,
        });
        const { executor, pools } = setup([
            { closeHangs: true, error: dropped },
            { fields: twoFields, rows: [[1, 'ok']] },
        ]);

        const result = await executor.run({ sql: 'select 1' });

        expect(result.rows).toEqual([[1, 'ok']]);
        expect(pools).toHaveLength(2);
        expect(pools[0]?.clients[0]?.released).toBe(true);
        expect(pools[1]?.clients[0]?.released).toBe(false);
    });

    it('retries on PostgreSQL admin shutdown (57P01)', async () => {
        const killed = Object.assign(
            new Error('terminating connection due to administrator command'),
            {
                code: '57P01',
            },
        );
        const { executor, pools } = setup([
            { error: killed },
            { fields: twoFields, rows: [[2, 'ok']] },
        ]);

        const result = await executor.run({ sql: 'select 1' });

        expect(result.rows).toEqual([[2, 'ok']]);
        expect(pools).toHaveLength(2);
    });

    it('rejects a SQL error promptly even when the portal close never completes', async () => {
        const error = Object.assign(new Error('syntax error at or near "selec"'), {
            code: '42601',
        });
        const { executor, pools } = setup([{ closeHangs: true, error }]);

        await expect(executor.run({ sql: 'selec 1' })).rejects.toBe(error);
        expect(pools).toHaveLength(1);
    });

    it('rejects an abort without waiting for the portal close', async () => {
        const rows = Array.from({ length: 500 }, (_, i) => [i, '']);
        const { executor, pools } = setup([
            { closeHangs: true, fields: twoFields, readDelayMs: 20, rows },
        ]);
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5);

        await expect(
            executor.run({ sql: 'select 1', signal: controller.signal, maxRows: 100000 }),
        ).rejects.toThrow(/abort/i);
        expect(pools[0]?.clients[0]?.released).toBe(true);
    });

    it('destroys the client when the portal close after truncation never completes', async () => {
        const rows = Array.from({ length: 10 }, (_, i) => [i, `n${i}`]);
        const { executor, pools } = setup([{ closeHangs: true, fields: twoFields, rows }]);

        const result = await executor.run({ sql: 'select * from t', maxRows: 3 });

        expect(result.rows).toHaveLength(3);
        expect(result.truncated).toBe(true);
        expect(pools[0]?.clients[0]?.released).toBe(true);
    });

    it('routes to the requested database', async () => {
        const { executor, pools } = setup([{ fields: [], rows: [] }]);

        await executor.run({ sql: 'select 1', database: 'archive' });

        expect(pools[0]?.database).toBe('archive');
    });
});

describe('PgExecutor statement splitting', () => {
    const cursorScript: Script = { fields: [{ name: 'n', dataTypeID: 23 }], rows: [[1]] };
    const simpleScript: Script = {
        simple: [
            {
                command: 'SELECT',
                rowCount: 1,
                rows: [{ n: 1 }],
                fields: [{ name: 'n', dataTypeID: 23 }],
            },
        ],
    };

    const usedSimple = async (sql: string): Promise<boolean> => {
        const { executor, pools } = setup([simpleScript, cursorScript]);
        await executor.run({ sql });
        return (pools[0]?.clients[0]?.simpleQueries.length ?? 0) > 0;
    };

    it.each([
        'select 1;',
        "select ';' as semi",
        'select $$a; b$$ as body',
        'select $tag$a; b$tag$ as body',
        'select 1 -- ; not a split\n',
        'select 1 /* ; not a split */',
        'select (select 1; ) as nested',
        'select "a;b"',
        "select 'it''s; fine'",
    ])('runs %j through the cursor (single statement)', async (sql) => {
        expect(await usedSimple(sql)).toBe(false);
    });

    it.each([
        'select 1; select 2',
        'select 1;\n\nselect 2',
        'select $$x$$; select 2',
        'select 1 /* a */; select 2',
    ])('runs %j through the simple protocol (multi statement)', async (sql) => {
        expect(await usedSimple(sql)).toBe(true);
    });

    it('accepts a single simple result object and truncates its rows to maxRows', async () => {
        const { executor } = setup([
            {
                simple: [
                    {
                        command: 'SELECT',
                        rowCount: 3,
                        rows: [{ n: 1 }, { n: 2 }, { n: 3 }],
                        fields: [{ name: 'n', dataTypeID: 23 }],
                    },
                ],
            },
        ]);

        const result = await executor.run({ sql: 'select 1; select n from t', maxRows: 2 });

        expect(result.rows).toEqual([[1], [2]]);
        expect(result.truncated).toBe(true);
    });

    it('reports no columns when a simple batch has no result set', async () => {
        const { executor } = setup([
            { simple: [{ command: 'CREATE', rowCount: null, rows: [], fields: [] }] },
        ]);

        const result = await executor.run({
            sql: 'create temp table a (x int); create temp table b (y int)',
        });

        expect(result.columns).toEqual([]);
        expect(result.rows).toEqual([]);
        expect(result.rowsAffected).toEqual([]);
    });

    it('rejects immediately when the signal is already aborted', async () => {
        const { executor, pools } = setup([cursorScript]);
        const controller = new AbortController();
        controller.abort();

        await expect(executor.run({ sql: 'select 1', signal: controller.signal })).rejects.toThrow(
            /abort/i,
        );
        expect(pools[0]?.clients[0]?.released).toBe(true);
    });
});
