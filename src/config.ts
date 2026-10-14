/**
 * Environment-driven configuration.
 *
 * Primary names use the `SQLSERVER_` prefix. The `MSSQL_` prefix is accepted as a
 * fallback so users migrating from other SQL Server MCP packages do not have to
 * rename their settings.
 */
export type Config = {
    allowedDatabases: string[];
    connectionTimeoutMs: number;
    database: string | undefined;
    domain: string | undefined;
    encrypt: boolean;
    maxRows: number;
    password: string;
    poolMax: number;
    port: number;
    queryLog: boolean;
    readOnly: boolean;
    requestTimeoutMs: number;
    server: string;
    trustServerCertificate: boolean;
    useUtc: boolean;
    user: string;
};

export type Env = Record<string, string | undefined>;

const ALIASES: Record<string, string> = {
    SQLSERVER_HOST: 'MSSQL_SERVER',
    SQLSERVER_PORT: 'MSSQL_PORT',
    SQLSERVER_USER: 'MSSQL_USER',
    SQLSERVER_PASSWORD: 'MSSQL_PASSWORD',
    SQLSERVER_DATABASE: 'MSSQL_DATABASE',
    SQLSERVER_DATABASES: 'MSSQL_DATABASES',
    SQLSERVER_DOMAIN: 'MSSQL_DOMAIN',
    SQLSERVER_ENCRYPT: 'MSSQL_ENCRYPT',
    SQLSERVER_TRUST_CERT: 'MSSQL_TRUST_CERT',
    SQLSERVER_READ_ONLY: 'MSSQL_READ_ONLY',
    SQLSERVER_MAX_ROWS: 'MSSQL_MAX_ROWS',
    SQLSERVER_CONNECTION_TIMEOUT: 'MSSQL_CONNECTION_TIMEOUT',
    SQLSERVER_REQUEST_TIMEOUT: 'MSSQL_REQUEST_TIMEOUT',
    SQLSERVER_POOL_MAX: 'MSSQL_POOL_MAX',
    SQLSERVER_USE_UTC: 'MSSQL_USE_UTC',
    SQLSERVER_QUERY_LOG: 'MSSQL_QUERY_LOG',
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigError';
    }
}

const read = (env: Env, name: string): string | undefined => {
    const primary = env[name]?.trim();
    if (primary) {
        return primary;
    }
    const alias = ALIASES[name];
    const fallback = alias ? env[alias]?.trim() : undefined;
    return fallback || undefined;
};

const readRequired = (env: Env, name: string): string => {
    const value = read(env, name);
    if (!value) {
        throw new ConfigError(`${name} is required (or its ${ALIASES[name]} alias).`);
    }
    return value;
};

const readBoolean = (env: Env, name: string, fallback: boolean): boolean => {
    const value = read(env, name);
    if (value === undefined) {
        return fallback;
    }
    const normalized = value.toLowerCase();
    if (TRUE_VALUES.has(normalized)) {
        return true;
    }
    if (FALSE_VALUES.has(normalized)) {
        return false;
    }
    throw new ConfigError(`${name} must be a boolean (true/false), got "${value}".`);
};

const readPositiveInteger = (env: Env, name: string, fallback: number): number => {
    const value = read(env, name);
    if (value === undefined) {
        return fallback;
    }
    const parsed = Number(value);
    const isPositiveInteger = Number.isInteger(parsed) && parsed > 0;
    if (!isPositiveInteger) {
        throw new ConfigError(`${name} must be a positive integer, got "${value}".`);
    }
    return parsed;
};

const readList = (env: Env, name: string): string[] => {
    const value = read(env, name);
    if (!value) {
        return [];
    }
    return value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
};

const resolveDatabases = (env: Env): { database: string | undefined; allowed: string[] } => {
    const explicit = read(env, 'SQLSERVER_DATABASE');
    const allowlist = readList(env, 'SQLSERVER_DATABASES');
    const database = explicit ?? allowlist[0];
    if (!database) {
        return { database: undefined, allowed: [] };
    }
    const hasAllowlist = allowlist.length > 0;
    const defaultIsAllowed = allowlist.includes(database);
    if (explicit && hasAllowlist && !defaultIsAllowed) {
        throw new ConfigError(
            `SQLSERVER_DATABASE "${database}" must be included in SQLSERVER_DATABASES.`,
        );
    }
    const others = allowlist.filter((entry) => entry !== database);
    return { database, allowed: [database, ...others] };
};

/**
 * Builds the server configuration from an environment map. Throws {@link ConfigError}
 * with an actionable message when a required value is missing or malformed.
 */
export const loadConfig = (env: Env = process.env): Config => {
    const server = readRequired(env, 'SQLSERVER_HOST');
    const user = readRequired(env, 'SQLSERVER_USER');
    const password = readRequired(env, 'SQLSERVER_PASSWORD');
    const { database, allowed } = resolveDatabases(env);

    return {
        allowedDatabases: allowed,
        connectionTimeoutMs: readPositiveInteger(env, 'SQLSERVER_CONNECTION_TIMEOUT', 8000),
        database,
        domain: read(env, 'SQLSERVER_DOMAIN'),
        encrypt: readBoolean(env, 'SQLSERVER_ENCRYPT', true),
        maxRows: readPositiveInteger(env, 'SQLSERVER_MAX_ROWS', 1000),
        password,
        poolMax: readPositiveInteger(env, 'SQLSERVER_POOL_MAX', 10),
        port: readPositiveInteger(env, 'SQLSERVER_PORT', 1433),
        queryLog: readBoolean(env, 'SQLSERVER_QUERY_LOG', false),
        readOnly: readBoolean(env, 'SQLSERVER_READ_ONLY', true),
        requestTimeoutMs: readPositiveInteger(env, 'SQLSERVER_REQUEST_TIMEOUT', 30000),
        server,
        trustServerCertificate: readBoolean(env, 'SQLSERVER_TRUST_CERT', false),
        useUtc: readBoolean(env, 'SQLSERVER_USE_UTC', true),
        user,
    };
};
