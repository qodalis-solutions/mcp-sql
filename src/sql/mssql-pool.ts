import sql from 'mssql';
import type { Config } from '../config.js';
import type { QueryPoolLike } from './executor.js';

const APP_NAME = 'qodalis-mcp-sqlserver';

/** Maps our configuration onto the mssql driver's config for one database. */
export const toMssqlConfig = (config: Config, database: string | undefined): sql.config => {
    const base: sql.config = {
        server: config.server,
        port: config.port,
        ...(database ? { database } : {}),
        connectionTimeout: config.connectionTimeoutMs,
        requestTimeout: config.requestTimeoutMs,
        pool: { max: config.poolMax, min: 0, idleTimeoutMillis: 30000 },
        options: {
            appName: APP_NAME,
            enableArithAbort: true,
            encrypt: config.encrypt,
            trustServerCertificate: config.trustServerCertificate,
            useUTC: config.useUtc,
        },
        // Validate pooled connections with SELECT 1 before handing them out so a
        // socket that died while idle is replaced by the driver, not by a failed query.
        validateConnection: true,
    };
    if (config.domain) {
        return {
            ...base,
            authentication: {
                type: 'ntlm',
                options: {
                    domain: config.domain,
                    userName: config.user,
                    password: config.password,
                },
            },
        };
    }
    return { ...base, user: config.user, password: config.password };
};

/** Pool factory used by the PoolManager in production. */
export const createMssqlPool =
    (config: Config) =>
    (database: string | undefined): QueryPoolLike =>
        new sql.ConnectionPool(toMssqlConfig(config, database)) as unknown as QueryPoolLike;
