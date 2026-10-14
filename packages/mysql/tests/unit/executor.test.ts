import { describe, expect, it } from 'vitest';
import { PoolManager } from '@qodalis/mcp-sql-core';
import { MysqlExecutor } from '../../src/sql/executor.js';
import { FakeMysqlPool, type Script } from '../helpers/fake-mysql.js';

const LONG = 3;
const VAR_STRING = 253;
const NOT_NULL = 1;

const twoFields = [
    { name: 'id', columnType: LONG, flags: NOT_NULL },
    { name: 'name', columnType: VAR_STRING, flags: 0 },
];

const setup = (scripts: Script[], maxRows = 1000) => {
    const pools: FakeMysqlPool[] = [];
    const manager = new PoolManager<FakeMysqlPool>({
        createPool: (database) => {
            const pool = new FakeMysqlPool(database);
            pool.scripts = scripts;
            pools.push(pool);
            return pool;
        },
    });
    return { executor: new MysqlExecutor(manager, { maxRows, queryTimeoutMs: 1234 }), pools };
};

describe('MysqlExecutor.run', () => {
    it('returns typed columns and rows as arrays in field order', async () => {
        const { executor, pools } = setup([
            {
                results: [
                    {
                        fields: twoFields,
                        rows: [
                            [1, 'a'],
                            [2, 'b'],
                        ],
                    },
                ],
            },
        ]);

        const result = await executor.run({ sql: 'select id, name from t' });

        expect(result.columns).toEqual([
            { name: 'id', type: 'int', nullable: false },
            { name: 'name', type: 'varchar', nullable: true },
        ]);
        expect(result.rows).toEqual([
            [1, 'a'],
            [2, 'b'],
        ]);
        expect(result.rowCount).toBe(2);
        expect(result.truncated).toBe(false);
        expect(pools[0]?.connections[0]?.released).toBe(false);
        expect(pools[0]?.connections[0]?.queries[0]).toMatchObject({
            rowsAsArray: true,
            timeout: 1234,
        });
    });

    it('stops at maxRows, flags truncation and destroys the connection so the rest is never read', async () => {
        const rows = Array.from({ length: 10 }, (_, i) => [i, `n${i}`]);
        const { executor, pools } = setup([{ results: [{ fields: twoFields, rows }] }]);

        const result = await executor.run({ sql: 'select * from t', maxRows: 3 });

        expect(result.rows).toHaveLength(3);
        expect(result.truncated).toBe(true);
        expect(pools[0]?.connections[0]?.released).toBe(true);
    });

    it('rewrites @name params to ? and passes the values', async () => {
        const { executor, pools } = setup([{ results: [{ fields: twoFields, rows: [] }] }]);

        await executor.run({
            sql: 'select * from t where id = @id and name = @name',
            params: { id: 7, name: 'x' },
        });

        expect(pools[0]?.connections[0]?.queries[0]).toMatchObject({
            sql: 'select * from t where id = ? and name = ?',
            values: [7, 'x'],
        });
    });

    it('takes the last result set of a multi-statement batch and collects affected rows', async () => {
        const { executor } = setup([
            {
                results: [
                    { affectedRows: 0 },
                    { affectedRows: 2 },
                    { fields: [{ name: 'n', columnType: LONG, flags: 0 }], rows: [[1]] },
                ],
            },
        ]);

        const result = await executor.run({
            sql: 'create temporary table tmp_a (n int); insert into tmp_a values (1),(2); select n from tmp_a',
        });

        expect(result.columns).toEqual([{ name: 'n', type: 'int', nullable: true }]);
        expect(result.rows).toEqual([[1]]);
        expect(result.rowsAffected).toEqual([0, 2]);
    });

    it('reports rowsAffected for a command without a result set', async () => {
        const { executor } = setup([{ results: [{ affectedRows: 4 }] }]);

        const result = await executor.run({ sql: 'update t set a = 1' });

        expect(result.columns).toEqual([]);
        expect(result.rows).toEqual([]);
        expect(result.rowsAffected).toEqual([4]);
    });

    it('propagates SQL errors untouched and returns the connection normally', async () => {
        const error = Object.assign(new Error("Table 'sales.nope' doesn't exist"), {
            code: 'ER_NO_SUCH_TABLE',
        });
        const { executor, pools } = setup([{ error }]);

        await expect(executor.run({ sql: 'select * from nope' })).rejects.toBe(error);
        expect(pools[0]?.connections[0]?.released).toBe(false);
        expect(pools).toHaveLength(1);
    });

    it('retries once on a connection error with a fresh pool and destroys the dead connection', async () => {
        const dropped = Object.assign(
            new Error('Connection lost: The server closed the connection.'),
            {
                code: 'PROTOCOL_CONNECTION_LOST',
            },
        );
        const { executor, pools } = setup([
            { error: dropped },
            { results: [{ fields: twoFields, rows: [[1, 'ok']] }] },
        ]);

        const result = await executor.run({ sql: 'select 1' });

        expect(result.rows).toEqual([[1, 'ok']]);
        expect(pools).toHaveLength(2);
        expect(pools[0]?.connections[0]?.released).toBe(true);
    });

    it('destroys the connection and rejects when the abort signal fires mid-stream', async () => {
        const rows = Array.from({ length: 50 }, (_, i) => [i, '']);
        const { executor, pools } = setup([
            { results: [{ fields: twoFields, rows }], rowDelayMs: 5 },
        ]);
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 12);

        await expect(executor.run({ sql: 'select 1', signal: controller.signal })).rejects.toThrow(
            /abort/i,
        );
        expect(pools[0]?.connections[0]?.released).toBe(true);
    });

    it('rejects immediately when the signal is already aborted', async () => {
        const { executor, pools } = setup([{ results: [{ fields: twoFields, rows: [[1, 'a']] }] }]);
        const controller = new AbortController();
        controller.abort();

        await expect(executor.run({ sql: 'select 1', signal: controller.signal })).rejects.toThrow(
            /abort/i,
        );
        expect(pools[0]?.connections[0]?.released).toBe(true);
    });

    it('routes to the requested database', async () => {
        const { executor, pools } = setup([{ results: [] }]);

        await executor.run({ sql: 'select 1', database: 'archive' });

        expect(pools[0]?.database).toBe('archive');
    });

    it('reads NOT NULL from string flag lists as well as bit masks', async () => {
        const { executor } = setup([
            {
                results: [
                    {
                        fields: [{ name: 'a', columnType: LONG, flags: ['NOT_NULL', 'PRI_KEY'] }],
                        rows: [[1]],
                    },
                ],
            },
        ]);

        const result = await executor.run({ sql: 'select a from t' });

        expect(result.columns[0]?.nullable).toBe(false);
    });
});
