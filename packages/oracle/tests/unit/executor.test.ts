import { describe, expect, it } from 'vitest';
import { PoolManager } from '@qodalis/mcp-sql-core';
import type { Metadata } from 'oracledb';
import { OracleExecutor } from '../../src/sql/executor.js';
import { FakeOraclePool, type Script } from '../helpers/fake-oracle.js';

const setup = (scripts: Script[], maxRows = 1000, readOnly = true) => {
    const pools: FakeOraclePool[] = [];
    const manager = new PoolManager<FakeOraclePool>({
        createPool: (database) => {
            const pool = new FakeOraclePool(database);
            pool.scripts = [...scripts];
            pools.push(pool);
            return pool;
        },
    });
    return { executor: new OracleExecutor(manager, { maxRows, readOnly }), pools };
};

const twoColumns: Metadata[] = [
    { name: 'ID', dbTypeName: 'NUMBER', precision: 10, scale: 0, nullable: false },
    { name: 'NAME', dbTypeName: 'VARCHAR2', byteSize: 50, nullable: true },
];

describe('OracleExecutor.run', () => {
    it('returns typed columns and rows as arrays in column order', async () => {
        const { executor } = setup([
            {
                metaData: twoColumns,
                rows: [
                    [1, 'a'],
                    [2, 'b'],
                ],
            },
        ]);

        const result = await executor.run({ sql: 'select id, name from t' });

        expect(result.columns).toEqual([
            { name: 'ID', type: 'number(10)', nullable: false },
            { name: 'NAME', type: 'varchar2(50)', nullable: true },
        ]);
        expect(result.rows).toEqual([
            [1, 'a'],
            [2, 'b'],
        ]);
        expect(result.rowCount).toBe(2);
        expect(result.truncated).toBe(false);
    });

    it('reads through the result set in batches, stops at maxRows and closes the cursor', async () => {
        const rows = Array.from({ length: 10 }, (_, i) => [i, `n${i}`]);
        const { executor, pools } = setup([{ metaData: twoColumns, rows }]);

        const result = await executor.run({ sql: 'select * from t', maxRows: 3 });

        expect(result.rows).toHaveLength(3);
        expect(result.truncated).toBe(true);
        expect(pools[0]?.connections[0]?.resultSets[0]?.closed).toBe(true);
        expect(pools[0]?.connections[0]?.closedWith).toBeUndefined();
    });

    it('rewrites @name params to :name binds', async () => {
        const { executor, pools } = setup([{ metaData: twoColumns, rows: [] }]);

        await executor.run({
            sql: 'select * from t where id = @id and name = @name',
            params: { id: 7, name: 'x' },
        });

        expect(pools[0]?.connections[0]?.executed[0]).toMatchObject({
            sql: 'select * from t where id = :b_id and name = :b_name',
            binds: { b_id: 7, b_name: 'x' },
        });
    });

    it('runs a multi-statement batch sequentially on one connection and returns the last result set', async () => {
        const { executor, pools } = setup([
            { rowsAffected: 0 },
            { rowsAffected: 2 },
            { metaData: [{ name: 'N', dbTypeName: 'NUMBER' }], rows: [[1]] },
        ]);

        const result = await executor.run({
            sql: 'create private temporary table ora$ptt_a (n number); insert into ora$ptt_a values (1); select n from ora$ptt_a',
        });

        expect(pools[0]?.connections).toHaveLength(1);
        expect(pools[0]?.connections[0]?.executed).toHaveLength(3);
        expect(result.columns).toEqual([{ name: 'N', type: 'number', nullable: true }]);
        expect(result.rows).toEqual([[1]]);
        expect(result.rowsAffected).toEqual([0, 2]);
    });

    it('rejects params together with a multi-statement batch with a clear message', async () => {
        const { executor } = setup([{}]);

        await expect(
            executor.run({ sql: 'select 1 from dual; select @a from dual', params: { a: 1 } }),
        ).rejects.toThrow(/single statement/i);
    });

    it('reports rowsAffected for a command without a result set', async () => {
        const { executor } = setup([{ rowsAffected: 4 }], 1000, false);

        const result = await executor.run({ sql: 'update t set a = 1' });

        expect(result.columns).toEqual([]);
        expect(result.rowsAffected).toEqual([4]);
    });

    it('never commits in read-only mode: autoCommit off and a rollback before release', async () => {
        const { executor, pools } = setup([{ metaData: twoColumns, rows: [] }]);

        await executor.run({ sql: 'select 1 from dual' });

        const connection = pools[0]?.connections[0];
        expect(connection?.executed[0]?.autoCommit).toBe(false);
        expect(connection?.rollbacks).toBe(1);
    });

    it('autocommits in write mode without rolling back', async () => {
        const { executor, pools } = setup([{ rowsAffected: 1 }], 1000, false);

        await executor.run({ sql: 'insert into t values (1)' });

        const connection = pools[0]?.connections[0];
        expect(connection?.executed[0]?.autoCommit).toBe(true);
        expect(connection?.rollbacks).toBe(0);
    });

    it('propagates SQL errors untouched and returns the connection normally', async () => {
        const error = Object.assign(new Error('ORA-00942: table or view does not exist'), {
            code: 'ORA-00942',
            errorNum: 942,
        });
        const { executor, pools } = setup([{ error }]);

        await expect(executor.run({ sql: 'select * from nope' })).rejects.toBe(error);
        expect(pools[0]?.connections[0]?.closedWith).toBeUndefined();
        expect(pools).toHaveLength(1);
    });

    it('retries once on a connection error with a fresh pool and drops the dead connection', async () => {
        const dropped = Object.assign(
            new Error('ORA-03113: end-of-file on communication channel'),
            { code: 'ORA-03113' },
        );
        const pools: FakeOraclePool[] = [];
        const scripts: Script[][] = [
            [{ error: dropped }],
            [{ metaData: twoColumns, rows: [[1, 'ok']] }],
        ];
        const manager = new PoolManager<FakeOraclePool>({
            createPool: (database) => {
                const pool = new FakeOraclePool(database);
                pool.scripts = scripts.shift() ?? [];
                pools.push(pool);
                return pool;
            },
        });
        const executor = new OracleExecutor(manager, { maxRows: 10, readOnly: true });

        const result = await executor.run({ sql: 'select 1 from dual' });

        expect(result.rows).toEqual([[1, 'ok']]);
        expect(pools).toHaveLength(2);
        expect(pools[0]?.connections[0]?.closedWith).toEqual({ drop: true });
        expect(pools[0]?.connections[0]?.rollbacks).toBe(0);
    });

    it('rejects and drops the connection when the abort signal fires mid-stream', async () => {
        const rows = Array.from({ length: 1000 }, (_, i) => [i, '']);
        const { executor, pools } = setup([{ metaData: twoColumns, readDelayMs: 20, rows }]);
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5);

        await expect(
            executor.run({ sql: 'select 1 from dual', signal: controller.signal, maxRows: 100000 }),
        ).rejects.toThrow(/abort/i);
        expect(pools[0]?.connections[0]?.closedWith).toEqual({ drop: true });
        expect(pools[0]?.connections[0]?.resultSets[0]?.closed).toBe(true);
    });

    it('rejects immediately when the signal is already aborted', async () => {
        const { executor, pools } = setup([{ metaData: twoColumns, rows: [] }]);
        const controller = new AbortController();
        controller.abort();

        await expect(
            executor.run({ sql: 'select 1 from dual', signal: controller.signal }),
        ).rejects.toThrow(/abort/i);
        expect(pools[0]?.connections).toHaveLength(0);
    });

    it('flags LOB handles it could not inline', async () => {
        const lob = { getData: () => Promise.resolve('x') };
        const { executor } = setup([
            { metaData: [{ name: 'C', dbTypeName: 'CLOB' }], rows: [[lob]] },
        ]);

        const result = await executor.run({ sql: 'select c from t' });

        expect(result.rows).toEqual([['[lob]']]);
        expect(result.columns[0]?.type).toBe('clob');
    });

    it('routes to the requested schema pool key', async () => {
        const { executor, pools } = setup([{ metaData: twoColumns, rows: [] }]);

        await executor.run({ sql: 'select 1 from dual', database: 'HR' });

        expect(pools[0]?.database).toBe('HR');
    });
});
