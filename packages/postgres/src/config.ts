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
 * PostgreSQL configuration. Primary names use `POSTGRES_`; the libpq `PG*`
 * names are accepted as aliases, and `POSTGRES_URL` (or `DATABASE_URL`) may
 * supply everything at once, with explicit variables taking precedence.
 */
export type SslConfig = false | { rejectUnauthorized: boolean };

export type Config = CommonConfig & {
    applicationName: string;
    ssl: SslConfig;
};

const names = (suffix: string): string[] => envNames(['POSTGRES'], suffix);

export const ENV_SPEC: EnvSpec = {
    defaultPort: 5432,
    names: {
        connectionTimeout: names('CONNECTION_TIMEOUT'),
        database: [...names('DATABASE'), 'PGDATABASE'],
        databases: names('DATABASES'),
        host: [...names('HOST'), 'PGHOST'],
        maxRows: names('MAX_ROWS'),
        password: [...names('PASSWORD'), 'PGPASSWORD'],
        poolMax: names('POOL_MAX'),
        port: [...names('PORT'), 'PGPORT'],
        queryLog: names('QUERY_LOG'),
        readOnly: names('READ_ONLY'),
        requestTimeout: names('REQUEST_TIMEOUT'),
        user: [...names('USER'), 'PGUSER'],
    },
    passwordOptional: true,
};

export const ENV_FILE_VARIABLES = names('ENV_FILE');

const SSL_VALUES: Record<string, SslConfig> = {
    false: false,
    off: false,
    disable: false,
    no: false,
    '0': false,
    true: { rejectUnauthorized: false },
    on: { rejectUnauthorized: false },
    require: { rejectUnauthorized: false },
    yes: { rejectUnauthorized: false },
    '1': { rejectUnauthorized: false },
    verify: { rejectUnauthorized: true },
    'verify-full': { rejectUnauthorized: true },
    'verify-ca': { rejectUnauthorized: true },
};

const parseSsl = (value: string | undefined): SslConfig => {
    if (value === undefined) {
        return { rejectUnauthorized: false };
    }
    const parsed = SSL_VALUES[value.toLowerCase()];
    if (parsed === undefined) {
        throw new ConfigError(
            `POSTGRES_SSL must be one of false, require, verify; got "${value}".`,
        );
    }
    return parsed;
};

/** Expands a connection URL into the equivalent variables (explicit ones win). */
const envFromUrl = (env: Env): Env => {
    const url = env.POSTGRES_URL?.trim() || env.DATABASE_URL?.trim();
    if (!url) {
        return env;
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new ConfigError('POSTGRES_URL is not a valid URL.');
    }
    const fromUrl: Env = {
        POSTGRES_HOST: parsed.hostname || undefined,
        POSTGRES_PORT: parsed.port || undefined,
        POSTGRES_USER: parsed.username ? decodeURIComponent(parsed.username) : undefined,
        POSTGRES_PASSWORD: parsed.password ? decodeURIComponent(parsed.password) : undefined,
        POSTGRES_DATABASE: parsed.pathname.replace(/^\//, '') || undefined,
        POSTGRES_SSL: parsed.searchParams.get('sslmode') ?? undefined,
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
        applicationName: read.optional(names('APPLICATION_NAME')) ?? 'qodalis-mcp-postgres',
        ssl: parseSsl(read.optional([...names('SSL'), 'PGSSLMODE'])),
    };
};

export { ConfigError } from '@qodalis/mcp-sql-core';
