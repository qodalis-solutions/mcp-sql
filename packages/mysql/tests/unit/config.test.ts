import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const base = {
    MYSQL_HOST: 'db.example.com',
    MYSQL_USER: 'reader',
    MYSQL_PASSWORD: 'secret',
    MYSQL_DATABASE: 'sales',
};

describe('loadConfig (mysql)', () => {
    it('reads the shared settings with MySQL defaults', () => {
        const config = loadConfig(base);
        expect(config).toMatchObject({
            server: 'db.example.com',
            user: 'reader',
            password: 'secret',
            database: 'sales',
            port: 3306,
            readOnly: true,
            maxRows: 1000,
        });
    });

    it('defaults ssl to off, like a local server, and supports require/verify', () => {
        expect(loadConfig(base).ssl).toBe(false);
        expect(loadConfig({ ...base, MYSQL_SSL: 'require' }).ssl).toEqual({
            rejectUnauthorized: false,
        });
        expect(loadConfig({ ...base, MYSQL_SSL: 'verify' }).ssl).toEqual({
            rejectUnauthorized: true,
        });
        expect(() => loadConfig({ ...base, MYSQL_SSL: 'maybe' })).toThrow(/MYSQL_SSL/);
    });

    it('accepts MARIADB_* names as aliases', () => {
        const config = loadConfig({
            MARIADB_HOST: 'h',
            MARIADB_USER: 'u',
            MARIADB_PASSWORD: 'p',
            MARIADB_DATABASE: 'd',
            MARIADB_PORT: '3307',
        });
        expect(config).toMatchObject({
            server: 'h',
            user: 'u',
            password: 'p',
            database: 'd',
            port: 3307,
        });
    });

    it('accepts a connection URL and lets explicit variables override it', () => {
        const config = loadConfig({
            MYSQL_URL: 'mysql://u:p%40ss@h:3307/d?ssl=require',
            MYSQL_USER: 'override',
        });
        expect(config).toMatchObject({
            server: 'h',
            user: 'override',
            password: 'p@ss',
            database: 'd',
            port: 3307,
            ssl: { rejectUnauthorized: false },
        });
        expect(() => loadConfig({ MYSQL_URL: '::nope' })).toThrow(/MYSQL_URL/);
    });

    it('allows an empty password', () => {
        expect(loadConfig({ MYSQL_HOST: 'localhost', MYSQL_USER: 'me' }).password).toBe('');
    });

    it('supports a database allowlist', () => {
        expect(loadConfig({ ...base, MYSQL_DATABASES: 'sales,archive' }).allowedDatabases).toEqual([
            'sales',
            'archive',
        ]);
    });
});

describe('typeNameForColumn', () => {
    it('names the common column types and distinguishes text from binary blobs', async () => {
        const { typeNameForColumn } = await import('../../src/sql/types.js');
        expect(typeNameForColumn(3, 0)).toBe('int');
        expect(typeNameForColumn(8, 0)).toBe('bigint');
        expect(typeNameForColumn(246, 0)).toBe('decimal');
        expect(typeNameForColumn(253, 0)).toBe('varchar');
        expect(typeNameForColumn(252, 0)).toBe('text');
        expect(typeNameForColumn(252, 128)).toBe('blob');
        expect(typeNameForColumn(245, 0)).toBe('json');
        expect(typeNameForColumn(9999, 0)).toBe('type:9999');
    });
});
