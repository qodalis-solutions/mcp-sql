import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const base = {
    POSTGRES_HOST: 'db.example.com',
    POSTGRES_USER: 'reader',
    POSTGRES_PASSWORD: 'secret',
    POSTGRES_DATABASE: 'sales',
};

describe('loadConfig (postgres)', () => {
    it('reads the shared settings with Postgres defaults', () => {
        const config = loadConfig(base);
        expect(config).toMatchObject({
            server: 'db.example.com',
            user: 'reader',
            password: 'secret',
            database: 'sales',
            port: 5432,
            readOnly: true,
            maxRows: 1000,
        });
    });

    it('defaults ssl to require-but-not-verify, like most hosted Postgres setups', () => {
        const config = loadConfig(base);
        expect(config.ssl).toEqual({ rejectUnauthorized: false });
    });

    it('turns ssl off or on strict verification', () => {
        expect(loadConfig({ ...base, POSTGRES_SSL: 'false' }).ssl).toBe(false);
        expect(loadConfig({ ...base, POSTGRES_SSL: 'verify' }).ssl).toEqual({
            rejectUnauthorized: true,
        });
        expect(() => loadConfig({ ...base, POSTGRES_SSL: 'maybe' })).toThrow(/POSTGRES_SSL/);
    });

    it('accepts the libpq PG* names as aliases', () => {
        const config = loadConfig({
            PGHOST: 'h',
            PGUSER: 'u',
            PGPASSWORD: 'p',
            PGDATABASE: 'd',
            PGPORT: '5433',
        });
        expect(config).toMatchObject({
            server: 'h',
            user: 'u',
            password: 'p',
            database: 'd',
            port: 5433,
        });
    });

    it('accepts a connection string and lets explicit variables override it', () => {
        const config = loadConfig({
            POSTGRES_URL: 'postgresql://u:p%40ss@h:5433/d?sslmode=disable',
            POSTGRES_USER: 'override',
        });
        expect(config).toMatchObject({
            server: 'h',
            user: 'override',
            password: 'p@ss',
            database: 'd',
            port: 5433,
            ssl: false,
        });
    });

    it('allows an empty password for trust authentication', () => {
        const config = loadConfig({ POSTGRES_HOST: 'localhost', POSTGRES_USER: 'me' });
        expect(config.password).toBe('');
    });

    it('supports a database allowlist', () => {
        const config = loadConfig({ ...base, POSTGRES_DATABASES: 'sales,archive' });
        expect(config.allowedDatabases).toEqual(['sales', 'archive']);
    });

    it('supports a statement timeout and application name', () => {
        const config = loadConfig({ ...base, POSTGRES_APPLICATION_NAME: 'bot' });
        expect(config.applicationName).toBe('bot');
        expect(loadConfig(base).applicationName).toMatch(/mcp-postgres/);
    });
});

describe('typeNameForOid', () => {
    it('names known oids and falls back to oid:n', async () => {
        const { typeNameForOid } = await import('../../src/sql/types.js');
        expect(typeNameForOid(23)).toBe('integer');
        expect(typeNameForOid(1184)).toBe('timestamptz');
        expect(typeNameForOid(999999)).toBe('oid:999999');
    });
});
