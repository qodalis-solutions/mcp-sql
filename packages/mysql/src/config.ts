import {
    ConfigError,
    createEnvReader,
    envNames,
    loadCommonConfig,
    type CommonConfig,
    type Env,
    type EnvSpec,
} from '@qodalis/mcp-sql-core';

/**
 * MySQL / MariaDB configuration. Primary names use `MYSQL_`; `MARIADB_` names
 * are accepted as aliases, and `MYSQL_URL` (or `DATABASE_URL`) may supply
 * everything at once, with explicit variables taking precedence.
 */
export type SslConfig = false | { rejectUnauthorized: boolean };

export type Config = CommonConfig & {
    ssl: SslConfig;
};

const names = (suffix: string): string[] => envNames(['MYSQL', 'MARIADB'], suffix);

export const ENV_SPEC: EnvSpec = {
    defaultPort: 3306,
    names: {
        connectionTimeout: names('CONNECTION_TIMEOUT'),
        database: names('DATABASE'),
        databases: names('DATABASES'),
        host: names('HOST'),
        maxRows: names('MAX_ROWS'),
        password: names('PASSWORD'),
        poolMax: names('POOL_MAX'),
        port: names('PORT'),
        queryLog: names('QUERY_LOG'),
        readOnly: names('READ_ONLY'),
        requestTimeout: names('REQUEST_TIMEOUT'),
        user: names('USER'),
    },
    passwordOptional: true,
};

export const ENV_FILE_VARIABLES = names('ENV_FILE');

const SSL_VALUES: Record<string, SslConfig> = {
    false: false,
    off: false,
    disable: false,
    disabled: false,
    no: false,
    '0': false,
    true: { rejectUnauthorized: false },
    on: { rejectUnauthorized: false },
    require: { rejectUnauthorized: false },
    required: { rejectUnauthorized: false },
    preferred: { rejectUnauthorized: false },
    yes: { rejectUnauthorized: false },
    '1': { rejectUnauthorized: false },
    verify: { rejectUnauthorized: true },
    verify_ca: { rejectUnauthorized: true },
    verify_identity: { rejectUnauthorized: true },
    'verify-full': { rejectUnauthorized: true },
};

const parseSsl = (value: string | undefined): SslConfig => {
    if (value === undefined) {
        return false;
    }
    const parsed = SSL_VALUES[value.toLowerCase()];
    if (parsed === undefined) {
        throw new ConfigError(`MYSQL_SSL must be one of false, require, verify; got "${value}".`);
    }
    return parsed;
};

/** Expands a connection URL into the equivalent variables (explicit ones win). */
const envFromUrl = (env: Env): Env => {
    const url = env.MYSQL_URL?.trim() || env.MARIADB_URL?.trim() || env.DATABASE_URL?.trim();
    if (!url) {
        return env;
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new ConfigError('MYSQL_URL is not a valid URL.');
    }
    const fromUrl: Env = {
        MYSQL_HOST: parsed.hostname || undefined,
        MYSQL_PORT: parsed.port || undefined,
        MYSQL_USER: parsed.username ? decodeURIComponent(parsed.username) : undefined,
        MYSQL_PASSWORD: parsed.password ? decodeURIComponent(parsed.password) : undefined,
        MYSQL_DATABASE: parsed.pathname.replace(/^\//, '') || undefined,
        MYSQL_SSL:
            parsed.searchParams.get('ssl') ?? parsed.searchParams.get('sslmode') ?? undefined,
    };
    const merged: Env = { ...env };
    for (const [key, value] of Object.entries(fromUrl)) {
        if (value !== undefined && !merged[key]?.trim()) {
            merged[key] = value;
        }
    }
    return merged;
};

export const loadConfig = (rawEnv: Env = process.env): Config => {
    const env = envFromUrl(rawEnv);
    const read = createEnvReader(env);
    return {
        ...loadCommonConfig(env, ENV_SPEC),
        ssl: parseSsl(read.optional(names('SSL'))),
    };
};

export { ConfigError } from '@qodalis/mcp-sql-core';
