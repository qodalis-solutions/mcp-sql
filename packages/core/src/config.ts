/**
 * Environment-driven configuration helpers shared by every dialect.
 *
 * A dialect declares its variable names (and aliases) through {@link EnvSpec};
 * the helpers do the parsing, validation and defaults.
 */
export type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConfigError';
    }
}

/** Settings every dialect shares; dialect configs extend this type. */
export type CommonConfig = {
    allowedDatabases: string[];
    connectionTimeoutMs: number;
    database: string | undefined;
    maxRows: number;
    password: string;
    poolMax: number;
    port: number;
    queryLog: boolean;
    readOnly: boolean;
    requestTimeoutMs: number;
    server: string;
    user: string;
};

export type CommonKey =
    | 'connectionTimeout'
    | 'database'
    | 'databases'
    | 'host'
    | 'maxRows'
    | 'password'
    | 'poolMax'
    | 'port'
    | 'queryLog'
    | 'readOnly'
    | 'requestTimeout'
    | 'user';

export type EnvSpec = {
    defaultPort: number;
    /** Variable names per key, most specific first; later entries are aliases. */
    names: Record<CommonKey, string[]>;
    /** Optional: let the password be empty (e.g. local trust auth). */
    passwordOptional?: boolean;
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export type EnvReader = {
    boolean: (names: string[], fallback: boolean) => boolean;
    list: (names: string[]) => string[];
    optional: (names: string[]) => string | undefined;
    positiveInteger: (names: string[], fallback: number) => number;
    required: (names: string[]) => string;
};

/** Builds typed readers over an environment map; the first non-empty name wins. */
export const createEnvReader = (env: Env): EnvReader => {
    const optional = (names: string[]): string | undefined => {
        for (const name of names) {
            const value = env[name]?.trim();
            if (value) {
                return value;
            }
        }
        return undefined;
    };
    const describe = (names: string[]): string =>
        names.length > 1
            ? `${names[0]} (or its alias ${names.slice(1).join(' / ')})`
            : (names[0] ?? '');
    const required = (names: string[]): string => {
        const value = optional(names);
        if (!value) {
            throw new ConfigError(`${describe(names)} is required.`);
        }
        return value;
    };
    const boolean = (names: string[], fallback: boolean): boolean => {
        const value = optional(names);
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
        throw new ConfigError(`${names[0]} must be a boolean (true/false), got "${value}".`);
    };
    const positiveInteger = (names: string[], fallback: number): number => {
        const value = optional(names);
        if (value === undefined) {
            return fallback;
        }
        const parsed = Number(value);
        const isPositiveInteger = Number.isInteger(parsed) && parsed > 0;
        if (!isPositiveInteger) {
            throw new ConfigError(`${names[0]} must be a positive integer, got "${value}".`);
        }
        return parsed;
    };
    const list = (names: string[]): string[] => {
        const value = optional(names);
        if (!value) {
            return [];
        }
        return value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    };
    return { boolean, list, optional, positiveInteger, required };
};

const resolveDatabases = (
    read: EnvReader,
    spec: EnvSpec,
): { database: string | undefined; allowed: string[] } => {
    const explicit = read.optional(spec.names.database);
    const allowlist = read.list(spec.names.databases);
    const database = explicit ?? allowlist[0];
    if (!database) {
        return { database: undefined, allowed: [] };
    }
    const hasAllowlist = allowlist.length > 0;
    const defaultIsAllowed = allowlist.includes(database);
    if (explicit && hasAllowlist && !defaultIsAllowed) {
        throw new ConfigError(
            `${spec.names.database[0]} "${database}" must be included in ${spec.names.databases[0]}.`,
        );
    }
    const others = allowlist.filter((entry) => entry !== database);
    return { database, allowed: [database, ...others] };
};

/** Loads the shared settings; dialects add their own on top. */
export const loadCommonConfig = (env: Env, spec: EnvSpec): CommonConfig => {
    const read = createEnvReader(env);
    const { database, allowed } = resolveDatabases(read, spec);
    const password = spec.passwordOptional
        ? (read.optional(spec.names.password) ?? '')
        : read.required(spec.names.password);
    return {
        allowedDatabases: allowed,
        connectionTimeoutMs: read.positiveInteger(spec.names.connectionTimeout, 8000),
        database,
        maxRows: read.positiveInteger(spec.names.maxRows, 1000),
        password,
        poolMax: read.positiveInteger(spec.names.poolMax, 10),
        port: read.positiveInteger(spec.names.port, spec.defaultPort),
        queryLog: read.boolean(spec.names.queryLog, false),
        readOnly: read.boolean(spec.names.readOnly, true),
        requestTimeoutMs: read.positiveInteger(spec.names.requestTimeout, 30000),
        server: read.required(spec.names.host),
        user: read.required(spec.names.user),
    };
};

/** `PREFIX_KEY` plus optional alias prefixes, e.g. `names('SQLSERVER', 'MSSQL')`. */
export const envNames = (prefixes: string[], suffix: string): string[] =>
    prefixes.map((prefix) => `${prefix}_${suffix}`);
