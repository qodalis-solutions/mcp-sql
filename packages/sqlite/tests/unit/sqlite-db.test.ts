import { unlinkSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createSqliteDatabase, SqliteDatabase } from '../../src/sql/sqlite-db.js';
import { makeTempDb, SAMPLE_SQL, writeFile, type TempDb } from '../helpers/temp-db.js';

let tmp: TempDb;

afterEach(async () => {
    await tmp?.cleanup();
});

describe('SqliteDatabase', () => {
    it('is connected only between connect() and close()', async () => {
        tmp = makeTempDb(SAMPLE_SQL);
        const db = createSqliteDatabase(tmp.config)(tmp.config.database);

        expect(db.connected).toBe(false);
        await db.connect();
        expect(db.connected).toBe(true);
        expect(db.connecting).toBe(false);
        await db.close();
        expect(db.connected).toBe(false);
    });

    it('reports not connected once the file on disk is a different inode', async () => {
        tmp = makeTempDb(SAMPLE_SQL);
        const db = createSqliteDatabase(tmp.config)(undefined);
        await db.connect();

        unlinkSync(tmp.file);
        writeFile(tmp.file, 'create table z (a)');

        expect(db.connected).toBe(false);
        await db.close();
    });

    it('reports not connected when the file disappears', async () => {
        tmp = makeTempDb(SAMPLE_SQL);
        const db = createSqliteDatabase(tmp.config)('app');
        await db.connect();

        unlinkSync(tmp.file);

        expect(db.connected).toBe(false);
        await db.close();
    });

    it('rejects an unknown database key', async () => {
        tmp = makeTempDb(SAMPLE_SQL);

        expect(() => createSqliteDatabase(tmp.config)('nope')).toThrow(/nope/);
    });

    it('opens :memory: read-write even in read-only mode, since an empty read-only memory db is useless', async () => {
        tmp = makeTempDb(SAMPLE_SQL);
        const config = loadConfig({ SQLITE_DATABASE: ':memory:' });
        const db = new SqliteDatabase(':memory:', config);
        await db.connect();

        expect(() => db.handle.exec('create table x (a)')).not.toThrow();
        expect(db.connected).toBe(true);
        await db.close();
    });

    it('has an inert error emitter so the pool manager can subscribe', async () => {
        tmp = makeTempDb(SAMPLE_SQL);
        const db = createSqliteDatabase(tmp.config)('app');

        expect(() => db.on('error', () => undefined)).not.toThrow();
    });
});
