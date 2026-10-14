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
 * Oracle configuration. Primary names use `ORACLE_`. A session always lives in
 * one database, so the shared `database` setting (and the `database` tool
 * argument) selects the SCHEMA used for object lookups; it defaults to the
 * connecting user. `ORACLE_CONNECT_STRING` (EZConnect or a TNS descriptor)
 * or `ORACLE_URL` may replace host/port/service, with explicit variables
 * taking precedence.
 */
export type Config = CommonConfig & {
    connectString: string;
    service: string | undefined;
    wallet: { location: string; password: string | undefined } | undefined;
};

const names = (suffix: string): string[] => envNames(['ORACLE'], suffix);

export const ENV_SPEC: EnvSpec = {
    defaultPort: 1521,
    names: {
        connectionTimeout: names('CONNECTION_TIMEOUT'),
        database: [...names('DATABASE'), ...names('SCHEMA')],
        databases: [...names('DATABASES'), ...names('SCHEMAS')],
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
};

export const ENV_FILE_VARIABLES = names('ENV_FILE');

/** Oracle folds unquoted identifiers to upper case; quoted ones keep their case. */
export const normalizeSchemaName = (name: string): string => {
    const trimmed = name.trim();
    const isQuoted = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
    return isQuoted ? trimmed.slice(1, -1) : trimmed.toUpperCase();
};

const EZCONNECT = /^(?:tcps?:\/\/)?([^:/(\s]+)(?::(\d+))?\/([^?\s]+)/i;

/** Pulls host, port and service out of an EZConnect string or a TNS descriptor. */
const describeConnectString = (
    connectString: string,
): { host: string; port: string | undefined; service: string | undefined } => {
    const ez = EZCONNECT.exec(connectString);
    if (ez) {
        return { host: ez[1] ?? connectString, port: ez[2], service: ez[3] };
    }
    const host = /\(\s*host\s*=\s*([^)]+)\)/i.exec(connectString)?.[1]?.trim();
    const port = /\(\s*port\s*=\s*(\d+)\s*\)/i.exec(connectString)?.[1];
    const service = /\(\s*service_name\s*=\s*([^)]+)\)/i.exec(connectString)?.[1]?.trim();
    return { host: host ?? connectString, port, service };
};

/** Expands ORACLE_URL / ORACLE_CONNECT_STRING into the equivalent variables (explicit ones win). */
const expandEnv = (env: Env): Env => {
    const fromSources: Env = {};
    const url = env.ORACLE_URL?.trim();
    if (url) {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            throw new ConfigError(
                'ORACLE_URL is not a valid URL (oracle://user:pass@host:port/service).',
            );
        }
        fromSources.ORACLE_HOST = parsed.hostname || undefined;
        fromSources.ORACLE_PORT = parsed.port || undefined;
        fromSources.ORACLE_USER = parsed.username ? decodeURIComponent(parsed.username) : undefined;
        fromSources.ORACLE_PASSWORD = parsed.password
            ? decodeURIComponent(parsed.password)
            : undefined;
        fromSources.ORACLE_SERVICE = parsed.pathname.replace(/^\//, '') || undefined;
    }
    const connectString = env.ORACLE_CONNECT_STRING?.trim();
    if (connectString) {
        const described = describeConnectString(connectString);
        fromSources.ORACLE_HOST = fromSources.ORACLE_HOST ?? described.host;
        fromSources.ORACLE_PORT = fromSources.ORACLE_PORT ?? described.port;
        fromSources.ORACLE_SERVICE = fromSources.ORACLE_SERVICE ?? described.service;
    }
    const merged: Env = { ...env };
    for (const [key, value] of Object.entries(fromSources)) {
        if (value !== undefined && !merged[key]?.trim()) {
            merged[key] = value;
        }
    }
    return merged;
};

export const loadConfig = (rawEnv: Env = process.env): Config => {
    const env = expandEnv(rawEnv);
    const read = createEnvReader(env);
    const common = loadCommonConfig(env, ENV_SPEC);
    const explicitConnectString = read.optional(names('CONNECT_STRING'));
    const service = read.optional(names('SERVICE'));
    if (!explicitConnectString && !service) {
        throw new ConfigError(
            'ORACLE_SERVICE is required (or supply ORACLE_CONNECT_STRING / ORACLE_URL).',
        );
    }
    const walletLocation = read.optional(names('WALLET_LOCATION'));
    const schema = normalizeSchemaName(common.database ?? common.user);
    return {
        ...common,
        allowedDatabases: common.allowedDatabases.map(normalizeSchemaName),
        connectString: explicitConnectString ?? `${common.server}:${common.port}/${service}`,
        database: schema,
        service,
        wallet: walletLocation
            ? { location: walletLocation, password: read.optional(names('WALLET_PASSWORD')) }
            : undefined,
    };
};

export { ConfigError } from '@qodalis/mcp-sql-core';
