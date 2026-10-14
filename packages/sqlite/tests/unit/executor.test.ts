import { existsSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTempDb, SAMPLE_SQL, writeFile, type TempDb } from '../helpers/temp-db.js';

let db: TempDb;

afterEach(async () => {
    await db?.cleanup();
});

describe('SqliteExecutor.run', () => {
    it('returns typed columns and rows as arrays, with safe bigints as numbers and blobs as buffers', async () => {
        db = makeTempDb(SAMPLE_SQL);

        const result = await db.executor.run({
            sql: 'select id, name, big, b, r from t order by id',
        });

        expect(result.columns).toEqual([
            { name: 'id', type: 'INTEGER', nullable: true },
            { name: 'name', type: 'TEXT', nullable: true },
            { name: 'big', type: 'INTEGER', nullable: true },
            { name: 'b', type: 'BLOB', nullable: true },
            { name: 'r', type: 'REAL', nullable: true },
        ]);
        expect(result.rows[0]).toEqual([1, 'a', '9007199254740993', Buffer.from([0, 255]), 1.5]);
        expect(result.rows[1]).toEqual([2, 'b', 42, null, null]);
        expect(result.rowCount).toBe(3);
        expect(result.truncated).toBe(false);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(result.messages).toEqual([]);
    });

    it('types expression columns from the first value when SQLite has no declared type', async () => {
        db = makeTempDb(SAMPLE_SQL);

        const result = await db.executor.run({
            sql: "select 1 + 1 as n, 'x' || 'y' as s, 1.5 as f, null as z",
        });

        expect(result.columns.map((c) => c.type)).toEqual(['INTEGER', 'TEXT', 'REAL', 'NULL']);
    });

    it('stops at maxRows and flags truncation', async () => {
        db = makeTempDb(SAMPLE_SQL);

        const result = await db.executor.run({ sql: 'select id from t order by id', maxRows: 2 });

        expect(result.rows).toEqual([[1], [2]]);
        expect(result.truncated).toBe(true);
    });

    it('binds @name parameters, converting booleans, and ignores unused ones', async () => {
        db = makeTempDb(SAMPLE_SQL);

        const result = await db.executor.run({
            sql: 'select id from t where flag = @flag and name <> @skip',
            params: { flag: true, skip: 'zzz', unused: 1 },
        });

        expect(result.rows).toEqual([[1]]);
    });

    it('fails clearly when a placeholder has no value', async () => {
        db = makeTempDb(SAMPLE_SQL);

        await expect(db.executor.run({ sql: 'select @missing as m' })).rejects.toThrow(/missing/);
    });

    it('runs a multi-statement batch, returning the last result set and the changes of each DML', async () => {
        db = makeTempDb(SAMPLE_SQL);

        const result = await db.executor.run({
            sql: `create temp table tmp_a (n int);
                  insert into tmp_a values (1), (2);
                  update tmp_a set n = n + 1;
                  select n from tmp_a order by n;`,
        });

        expect(result.columns.map((c) => c.name)).toEqual(['n']);
        expect(result.rows).toEqual([[2], [3]]);
        expect(result.rowsAffected).toEqual([2, 2]);
    });

    it('keeps a trigger body with its own semicolons in one statement', async () => {
        db = makeTempDb(SAMPLE_SQL, { SQLITE_READ_ONLY: 'false' });

        const result = await db.executor.run({
            sql: `create table log (msg text);
                  create trigger tr after insert on t begin insert into log values ('x'); insert into log values ('y'); end;
                  insert into t (id, name) values (9, 'z');
                  select count(*) as n from log`,
        });

        expect(result.rows).toEqual([[2]]);
    });

    it('rejects params together with a multi-statement batch', async () => {
        db = makeTempDb(SAMPLE_SQL);

        await expect(
            db.executor.run({ sql: 'select 1; select @a', params: { a: 1 } }),
        ).rejects.toThrow(/single statement/i);
    });

    it('reports rowsAffected for a lone DML and no columns for DDL', async () => {
        db = makeTempDb(SAMPLE_SQL, { SQLITE_READ_ONLY: 'false' });

        const dml = await db.executor.run({ sql: 'update t set name = upper(name)' });
        expect(dml.columns).toEqual([]);
        expect(dml.rowsAffected).toEqual([3]);

        const ddl = await db.executor.run({ sql: 'create table extra (a)' });
        expect(ddl.columns).toEqual([]);
        expect(ddl.rowsAffected).toEqual([]);
    });

    it('propagates SQL errors with the SQLite error code', async () => {
        db = makeTempDb(SAMPLE_SQL);

        await expect(db.executor.run({ sql: 'select * from nope' })).rejects.toMatchObject({
            message: expect.stringMatching(/no such table: nope/),
        });
    });

    it('rejects a pre-aborted request without running anything', async () => {
        db = makeTempDb(SAMPLE_SQL);
        const controller = new AbortController();
        controller.abort();

        await expect(
            db.executor.run({ sql: 'select 1', signal: controller.signal }),
        ).rejects.toThrow(/abort/i);
    });

    it('enforces the read-only file handle even if a write slipped past the guard', async () => {
        db = makeTempDb(SAMPLE_SQL);

        await expect(
            db.executor.run({ sql: "insert into t (id, name) values (10, 'q')" }),
        ).rejects.toThrow(/readonly/i);
    });

    it('reopens the file when it was replaced underneath the running server', async () => {
        db = makeTempDb(SAMPLE_SQL);
        expect((await db.executor.run({ sql: 'select count(*) from t' })).rows).toEqual([[3]]);

        unlinkSync(db.file);
        writeFile(db.file, 'create table t2 (z); insert into t2 values (1)');

        const result = await db.executor.run({ sql: 'select count(*) from t2' });
        expect(result.rows).toEqual([[1]]);
    });

    it('fails with the path when the file is missing and recovers once it is back', async () => {
        db = makeTempDb(SAMPLE_SQL);
        unlinkSync(db.file);

        await expect(db.executor.run({ sql: 'select 1' })).rejects.toThrow(db.file);

        writeFile(db.file, 'create table back (a)');
        expect(
            (await db.executor.run({ sql: "select name from sqlite_schema where type = 'table'" }))
                .rows,
        ).toEqual([['back']]);
    });

    it('creates a missing file in write mode when SQLITE_CREATE_IF_MISSING is set', async () => {
        db = makeTempDb(SAMPLE_SQL, {
            SQLITE_CREATE_IF_MISSING: 'true',
            SQLITE_READ_ONLY: 'false',
        });
        unlinkSync(db.file);

        await db.executor.run({ sql: 'create table fresh (a)' });

        expect(existsSync(db.file)).toBe(true);
    });

    it('reports a corrupt file and recovers after it is restored', async () => {
        db = makeTempDb(SAMPLE_SQL);
        rmSync(db.file);
        writeFileSync(db.file, 'definitely not a sqlite database'.repeat(8));

        await expect(db.executor.run({ sql: 'select 1 from t' })).rejects.toThrow(
            /not a database/i,
        );

        rmSync(db.file);
        writeFile(db.file, SAMPLE_SQL);
        expect((await db.executor.run({ sql: 'select count(*) from t' })).rows).toEqual([[3]]);
    });

    it('routes to the requested database key', async () => {
        db = makeTempDb(SAMPLE_SQL);
        const other = path.join(db.dir, 'other.db');
        writeFile(other, 'create table o (a); insert into o values (7)');
        const { loadConfig } = await import('../../src/config.js');
        const { PoolManager } = await import('@qodalis/mcp-sql-core');
        const { createSqliteDatabase } = await import('../../src/sql/sqlite-db.js');
        const { SqliteExecutor } = await import('../../src/sql/executor.js');
        const config = loadConfig({ SQLITE_DATABASE: db.file, SQLITE_DATABASES: other });
        const manager = new PoolManager({ createPool: createSqliteDatabase(config) });
        const executor = new SqliteExecutor(manager, { maxRows: 10 });

        expect((await executor.run({ sql: 'select a from o', database: 'other' })).rows).toEqual([
            [7],
        ]);
        await manager.closeAll();
    });

    it('serves an in-memory database', async () => {
        db = makeTempDb(SAMPLE_SQL);
        const { loadConfig } = await import('../../src/config.js');
        const { PoolManager } = await import('@qodalis/mcp-sql-core');
        const { createSqliteDatabase } = await import('../../src/sql/sqlite-db.js');
        const { SqliteExecutor } = await import('../../src/sql/executor.js');
        const config = loadConfig({ SQLITE_DATABASE: ':memory:' });
        const manager = new PoolManager({ createPool: createSqliteDatabase(config) });
        const executor = new SqliteExecutor(manager, { maxRows: 10 });

        await executor.run({ sql: 'create temp table m (a); insert into m values (1)' });
        expect((await executor.run({ sql: 'select a from m' })).rows).toEqual([[1]]);
        await manager.closeAll();
    });
});
