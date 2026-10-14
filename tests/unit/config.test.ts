import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const base = {
    SQLSERVER_HOST: 'db.example.com',
    SQLSERVER_USER: 'reader',
    SQLSERVER_PASSWORD: 'secret',
    SQLSERVER_DATABASE: 'Sales',
};

describe('loadConfig', () => {
    it('reads the required connection settings from the environment', () => {
        const config = loadConfig(base);

        expect(config.server).toBe('db.example.com');
        expect(config.user).toBe('reader');
        expect(config.password).toBe('secret');
        expect(config.database).toBe('Sales');
    });

    it('applies safe defaults for everything optional', () => {
        const config = loadConfig(base);

        expect(config.port).toBe(1433);
        expect(config.encrypt).toBe(true);
        expect(config.trustServerCertificate).toBe(false);
        expect(config.readOnly).toBe(true);
        expect(config.maxRows).toBe(1000);
        expect(config.connectionTimeoutMs).toBe(8000);
        expect(config.requestTimeoutMs).toBe(30000);
        expect(config.poolMax).toBe(10);
        expect(config.useUtc).toBe(true);
        expect(config.queryLog).toBe(false);
        expect(config.allowedDatabases).toEqual(['Sales']);
    });

    it('parses booleans and numbers from strings', () => {
        const config = loadConfig({
            ...base,
            SQLSERVER_PORT: '14330',
            SQLSERVER_ENCRYPT: 'false',
            SQLSERVER_TRUST_CERT: 'TRUE',
            SQLSERVER_READ_ONLY: 'false',
            SQLSERVER_MAX_ROWS: '50',
            SQLSERVER_CONNECTION_TIMEOUT: '3000',
            SQLSERVER_REQUEST_TIMEOUT: '9000',
            SQLSERVER_POOL_MAX: '2',
            SQLSERVER_USE_UTC: 'no',
            SQLSERVER_QUERY_LOG: '1',
        });

        expect(config.port).toBe(14330);
        expect(config.encrypt).toBe(false);
        expect(config.trustServerCertificate).toBe(true);
        expect(config.readOnly).toBe(false);
        expect(config.maxRows).toBe(50);
        expect(config.connectionTimeoutMs).toBe(3000);
        expect(config.requestTimeoutMs).toBe(9000);
        expect(config.poolMax).toBe(2);
        expect(config.useUtc).toBe(false);
        expect(config.queryLog).toBe(true);
    });

    it('accepts MSSQL_* names as a fallback for migration from other servers', () => {
        const config = loadConfig({
            MSSQL_SERVER: 'legacy.example.com',
            MSSQL_USER: 'u',
            MSSQL_PASSWORD: 'p',
            MSSQL_DATABASE: 'D',
            MSSQL_TRUST_CERT: 'true',
        });

        expect(config.server).toBe('legacy.example.com');
        expect(config.database).toBe('D');
        expect(config.trustServerCertificate).toBe(true);
    });

    it('prefers SQLSERVER_* over MSSQL_* when both are set', () => {
        const config = loadConfig({ ...base, MSSQL_SERVER: 'other' });

        expect(config.server).toBe('db.example.com');
    });

    it('builds the database allowlist from SQLSERVER_DATABASES and keeps the default first', () => {
        const config = loadConfig({ ...base, SQLSERVER_DATABASES: 'Archive, Sales ,Reports' });

        expect(config.allowedDatabases).toEqual(['Sales', 'Archive', 'Reports']);
    });

    it('uses the first allowlisted database as default when SQLSERVER_DATABASE is missing', () => {
        const { SQLSERVER_DATABASE: _omit, ...rest } = base;
        const config = loadConfig({ ...rest, SQLSERVER_DATABASES: 'A,B' });

        expect(config.database).toBe('A');
        expect(config.allowedDatabases).toEqual(['A', 'B']);
    });

    it('supports NTLM domain authentication', () => {
        const config = loadConfig({ ...base, SQLSERVER_DOMAIN: 'CORP' });

        expect(config.domain).toBe('CORP');
    });

    it('fails with a clear message when the host is missing', () => {
        expect(() => loadConfig({ SQLSERVER_USER: 'u', SQLSERVER_PASSWORD: 'p' })).toThrow(
            /SQLSERVER_HOST/,
        );
    });

    it('fails when a numeric setting is not a positive integer', () => {
        expect(() => loadConfig({ ...base, SQLSERVER_MAX_ROWS: 'lots' })).toThrow(
            /SQLSERVER_MAX_ROWS/,
        );
        expect(() => loadConfig({ ...base, SQLSERVER_PORT: '0' })).toThrow(/SQLSERVER_PORT/);
    });

    it('fails when the default database is not in the allowlist', () => {
        expect(() => loadConfig({ ...base, SQLSERVER_DATABASES: 'Other' })).toThrow(
            /SQLSERVER_DATABASE/,
        );
    });
});
