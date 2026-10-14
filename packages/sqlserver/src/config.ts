import {
    createEnvReader,
    envNames,
    loadCommonConfig,
    type CommonConfig,
    type Env,
    type EnvSpec,
} from '@qodalis/mcp-sql-core';

/**
 * SQL Server configuration: the shared settings plus TLS, NTLM and UTC options.
 * Primary names use `SQLSERVER_`; `MSSQL_` is accepted as an alias.
 */
export type Config = CommonConfig & {
    domain: string | undefined;
    encrypt: boolean;
    trustServerCertificate: boolean;
    useUtc: boolean;
};

const PREFIXES = ['SQLSERVER', 'MSSQL'];

const names = (suffix: string): string[] => envNames(PREFIXES, suffix);

export const ENV_SPEC: EnvSpec = {
    defaultPort: 1433,
    names: {
        connectionTimeout: names('CONNECTION_TIMEOUT'),
        database: names('DATABASE'),
        databases: names('DATABASES'),
        host: ['SQLSERVER_HOST', 'MSSQL_SERVER', 'MSSQL_HOST'],
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

export const loadConfig = (env: Env = process.env): Config => {
    const read = createEnvReader(env);
    return {
        ...loadCommonConfig(env, ENV_SPEC),
        domain: read.optional(names('DOMAIN')),
        encrypt: read.boolean(names('ENCRYPT'), true),
        trustServerCertificate: read.boolean(names('TRUST_CERT'), false),
        useUtc: read.boolean(names('USE_UTC'), true),
    };
};

export { ConfigError } from '@qodalis/mcp-sql-core';
