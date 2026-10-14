import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const base = { SQLITE_DATABASE: '/data/app.db' };

describe('loadConfig (sqlite)', () => {
    it('maps the default file to a database key and keeps the absolute path', () => {
        const config = loadConfig(base);
        expect(config).toMatchObject({
            database: 'app',
            allowedDatabases: ['app'],
            files: { app: path.resolve('/data/app.db') },
            server: path.resolve('/data/app.db'),
            user: 'local',
            password: '',
            readOnly: true,
            maxRows: 1000,
            requestTimeoutMs: 30000,
            createIfMissing: false,
        });
    });

    it('resolves relative paths against the working directory', () => {
        expect(loadConfig({ SQLITE_DATABASE: 'data/app.sqlite' }).files.app).toBe(
            path.resolve('data/app.sqlite'),
        );
    });

    it('accepts :memory: as a database', () => {
        const config = loadConfig({ SQLITE_DATABASE: ':memory:' });
        expect(config.database).toBe('memory');
        expect(config.files.memory).toBe(':memory:');
    });

    it('builds the allowlist from SQLITE_DATABASES with the default first', () => {
        const config = loadConfig({
            ...base,
            SQLITE_DATABASES: '/data/archive.db,/tmp/Reports.sqlite3',
        });
        expect(config.allowedDatabases).toEqual(['app', 'archive', 'Reports']);
        expect(config.files.Reports).toBe(path.resolve('/tmp/Reports.sqlite3'));
    });

    it('uses the first allowlisted file as the default when SQLITE_DATABASE is absent', () => {
        const config = loadConfig({ SQLITE_DATABASES: '/data/a.db,/data/b.db' });
        expect(config.database).toBe('a');
        expect(config.allowedDatabases).toEqual(['a', 'b']);
    });

    it('rejects two files that would share a key', () => {
        expect(() => loadConfig({ ...base, SQLITE_DATABASES: '/other/app.db' })).toThrow(/app/);
    });

    it('requires at least one database', () => {
        expect(() => loadConfig({})).toThrow(/SQLITE_DATABASE/);
    });

    it('reads the optional settings', () => {
        const config = loadConfig({
            ...base,
            SQLITE_READ_ONLY: 'false',
            SQLITE_MAX_ROWS: '50',
            SQLITE_REQUEST_TIMEOUT: '1000',
            SQLITE_QUERY_LOG: 'true',
            SQLITE_CREATE_IF_MISSING: 'true',
        });
        expect(config).toMatchObject({
            readOnly: false,
            maxRows: 50,
            requestTimeoutMs: 1000,
            queryLog: true,
            createIfMissing: true,
        });
    });

    it('rejects a non-boolean read-only flag', () => {
        expect(() => loadConfig({ ...base, SQLITE_READ_ONLY: 'maybe' })).toThrow(
            /SQLITE_READ_ONLY/,
        );
    });
});
