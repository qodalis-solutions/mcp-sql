import { describe, expect, it } from 'vitest';
import { loadConfig, normalizeSchemaName } from '../../src/config.js';

const base = {
    ORACLE_HOST: 'db.example.com',
    ORACLE_USER: 'reader',
    ORACLE_PASSWORD: 'secret',
    ORACLE_SERVICE: 'ORCLPDB1',
};

describe('loadConfig (oracle)', () => {
    it('reads the shared settings with Oracle defaults and builds an EZConnect string', () => {
        const config = loadConfig(base);
        expect(config).toMatchObject({
            server: 'db.example.com',
            user: 'reader',
            password: 'secret',
            port: 1521,
            readOnly: true,
            maxRows: 1000,
            service: 'ORCLPDB1',
            connectString: 'db.example.com:1521/ORCLPDB1',
        });
    });

    it('uses the upper-cased user as the default schema', () => {
        expect(loadConfig(base).database).toBe('READER');
        expect(loadConfig({ ...base, ORACLE_DATABASE: 'sales' }).database).toBe('SALES');
        expect(loadConfig({ ...base, ORACLE_SCHEMA: '"MixedCase"' }).database).toBe('MixedCase');
    });

    it('upper-cases the schema allowlist', () => {
        const config = loadConfig({ ...base, ORACLE_DATABASES: 'sales, "Odd"' });
        expect(config.allowedDatabases).toEqual(['SALES', 'Odd']);
    });

    it('requires a service unless a connect string or url is given', () => {
        expect(() => loadConfig({ ...base, ORACLE_SERVICE: '' })).toThrow(/ORACLE_SERVICE/);
    });

    it('accepts a full connect string and describes host, port and service from it', () => {
        const ez = loadConfig({
            ORACLE_USER: 'u',
            ORACLE_PASSWORD: 'p',
            ORACLE_CONNECT_STRING: 'h.example.com:1522/svc',
        });
        expect(ez).toMatchObject({
            server: 'h.example.com',
            port: 1522,
            service: 'svc',
            connectString: 'h.example.com:1522/svc',
        });

        const tns = loadConfig({
            ORACLE_USER: 'u',
            ORACLE_PASSWORD: 'p',
            ORACLE_CONNECT_STRING:
                '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=tns.example.com)(PORT=1523))(CONNECT_DATA=(SERVICE_NAME=pdb)))',
        });
        expect(tns).toMatchObject({ server: 'tns.example.com', port: 1523, service: 'pdb' });
        expect(tns.connectString).toMatch(/^\(DESCRIPTION/);
    });

    it('accepts an oracle:// url and lets explicit variables override it', () => {
        const config = loadConfig({
            ORACLE_URL: 'oracle://u:p%40ss@h:1522/svc',
            ORACLE_USER: 'override',
        });
        expect(config).toMatchObject({
            server: 'h',
            user: 'override',
            password: 'p@ss',
            port: 1522,
            service: 'svc',
        });
        expect(() => loadConfig({ ORACLE_URL: 'not a url' })).toThrow(/ORACLE_URL/);
    });

    it('reads wallet settings when given', () => {
        expect(loadConfig(base).wallet).toBeUndefined();
        expect(
            loadConfig({ ...base, ORACLE_WALLET_LOCATION: '/w', ORACLE_WALLET_PASSWORD: 'wp' })
                .wallet,
        ).toEqual({
            location: '/w',
            password: 'wp',
        });
    });

    it('normalises schema names like Oracle does', () => {
        expect(normalizeSchemaName(' hr ')).toBe('HR');
        expect(normalizeSchemaName('"hr"')).toBe('hr');
    });
});
