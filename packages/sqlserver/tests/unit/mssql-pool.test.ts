import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { toMssqlConfig } from '../../src/sql/mssql-pool.js';

const config = loadConfig({
    SQLSERVER_HOST: 'db.example.com',
    SQLSERVER_PORT: '1434',
    SQLSERVER_USER: 'reader',
    SQLSERVER_PASSWORD: 'secret',
    SQLSERVER_DATABASE: 'Sales',
    SQLSERVER_TRUST_CERT: 'true',
    SQLSERVER_CONNECTION_TIMEOUT: '5000',
    SQLSERVER_REQUEST_TIMEOUT: '7000',
    SQLSERVER_POOL_MAX: '4',
    SQLSERVER_USE_UTC: 'false',
});

describe('toMssqlConfig', () => {
    it('maps connection, TLS, timeout and pool settings onto the driver config', () => {
        const driver = toMssqlConfig(config, 'Sales');

        expect(driver).toMatchObject({
            server: 'db.example.com',
            port: 1434,
            user: 'reader',
            password: 'secret',
            database: 'Sales',
            connectionTimeout: 5000,
            requestTimeout: 7000,
            pool: { max: 4, min: 0 },
            options: {
                encrypt: true,
                trustServerCertificate: true,
                useUTC: false,
                enableArithAbort: true,
            },
        });
    });

    it('lets the caller override the database per pool', () => {
        expect(toMssqlConfig(config, 'Archive').database).toBe('Archive');
    });

    it('validates pooled connections before use so stale sockets are replaced by the driver', () => {
        expect(toMssqlConfig(config, 'Sales').validateConnection).toBe(true);
    });

    it('uses NTLM when a domain is configured', () => {
        const ntlm = toMssqlConfig(
            loadConfig({
                SQLSERVER_HOST: 'h',
                SQLSERVER_USER: 'u',
                SQLSERVER_PASSWORD: 'p',
                SQLSERVER_DOMAIN: 'CORP',
            }),
            undefined,
        );

        expect(ntlm.authentication).toEqual({
            type: 'ntlm',
            options: { domain: 'CORP', userName: 'u', password: 'p' },
        });
        expect(ntlm.user).toBeUndefined();
    });

    it('sets a short application name so sessions are identifiable in sys.dm_exec_sessions', () => {
        expect(toMssqlConfig(config, 'Sales').options?.appName).toMatch(/mcp-sqlserver/);
    });
});
