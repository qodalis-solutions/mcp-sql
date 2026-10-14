import { describe, expect, it } from 'vitest';
import { createEnvReader, envNames, loadCommonConfig, type EnvSpec } from '../../src/config.js';

const spec: EnvSpec = {
    defaultPort: 5432,
    names: {
        connectionTimeout: ['X_CONNECTION_TIMEOUT'],
        database: ['X_DATABASE', 'XDATABASE'],
        databases: ['X_DATABASES'],
        host: ['X_HOST', 'XHOST'],
        maxRows: ['X_MAX_ROWS'],
        password: ['X_PASSWORD', 'XPASSWORD'],
        poolMax: ['X_POOL_MAX'],
        port: ['X_PORT', 'XPORT'],
        queryLog: ['X_QUERY_LOG'],
        readOnly: ['X_READ_ONLY'],
        requestTimeout: ['X_REQUEST_TIMEOUT'],
        user: ['X_USER', 'XUSER'],
    },
};

const base = { X_HOST: 'h', X_USER: 'u', X_PASSWORD: 'p' };

describe('createEnvReader', () => {
    it('takes the first non-empty name in the list', () => {
        const read = createEnvReader({ A: '', B: ' b ' });
        expect(read.optional(['A', 'B'])).toBe('b');
    });

    it('names the primary variable and its aliases in the required error', () => {
        expect(() => createEnvReader({}).required(['X_HOST', 'XHOST'])).toThrow(
            /X_HOST \(or its alias XHOST\)/,
        );
    });

    it('parses booleans, positive integers and lists', () => {
        const read = createEnvReader({ B: 'off', N: '7', L: 'a, b,,c' });
        expect(read.boolean(['B'], true)).toBe(false);
        expect(read.positiveInteger(['N'], 1)).toBe(7);
        expect(read.list(['L'])).toEqual(['a', 'b', 'c']);
        expect(() => read.boolean(['N'], true)).toThrow(/boolean/);
        expect(() => read.positiveInteger(['B'], 1)).toThrow(/positive integer/);
    });
});

describe('loadCommonConfig', () => {
    it('applies the dialect default port and the shared defaults', () => {
        const config = loadCommonConfig(base, spec);
        expect(config).toMatchObject({
            server: 'h',
            user: 'u',
            password: 'p',
            port: 5432,
            readOnly: true,
            maxRows: 1000,
            connectionTimeoutMs: 8000,
            requestTimeoutMs: 30000,
            poolMax: 10,
            queryLog: false,
            database: undefined,
            allowedDatabases: [],
        });
    });

    it('honours aliases and the allowlist rules', () => {
        const config = loadCommonConfig(
            { XHOST: 'h2', XUSER: 'u', XPASSWORD: 'p', X_DATABASES: 'A,B', XPORT: '1' },
            spec,
        );
        expect(config.server).toBe('h2');
        expect(config.port).toBe(1);
        expect(config.database).toBe('A');
        expect(config.allowedDatabases).toEqual(['A', 'B']);
        expect(() =>
            loadCommonConfig({ ...base, X_DATABASE: 'Z', X_DATABASES: 'A' }, spec),
        ).toThrow(/X_DATABASE/);
    });

    it('can treat the password as optional for local trust authentication', () => {
        const config = loadCommonConfig(
            { X_HOST: 'h', X_USER: 'u' },
            { ...spec, passwordOptional: true },
        );
        expect(config.password).toBe('');
        expect(() => loadCommonConfig({ X_HOST: 'h', X_USER: 'u' }, spec)).toThrow(/X_PASSWORD/);
    });
});

describe('envNames', () => {
    it('expands a suffix over every prefix', () => {
        expect(envNames(['SQLSERVER', 'MSSQL'], 'PORT')).toEqual(['SQLSERVER_PORT', 'MSSQL_PORT']);
    });
});
