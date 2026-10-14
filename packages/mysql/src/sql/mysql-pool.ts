import { EventEmitter } from 'node:events';
import mysql from 'mysql2/promise';
import type { Config } from '../config.js';
import type {
    MysqlConnectionLike,
    MysqlPoolLike,
    MysqlQueryLike,
    MysqlQueryOptions,
} from './executor.js';

/** Maps our configuration onto the mysql2 pool options for one database. */
export const toMysqlConfig = (config: Config, database: string | undefined): mysql.PoolOptions => ({
    host: config.server,
    port: config.port,
    user: config.user,
    password: config.password,
    ...(database ? { database } : {}),
    ...(config.ssl ? { ssl: config.ssl } : {}),
    connectTimeout: config.connectionTimeoutMs,
    connectionLimit: config.poolMax,
    maxIdle: config.poolMax,
    idleTimeout: 30000,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    // `@name` parameters are rewritten to `?` by the executor; batches need multipleStatements.
    multipleStatements: true,
    namedPlaceholders: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: false,
    dateStrings: false,
    timezone: 'Z',
});

export type MysqlPoolOptions = {
    /** Builds the driver pool; tests inject a fake. Defaults to `mysql.createPool(config)`. */
    createDriverPool?: (config: mysql.PoolOptions) => mysql.Pool;
    /** How long `close()` waits for `pool.end()` before giving up. Default 3000 ms. */
    endTimeoutMs?: number;
};

/**
 * Adapts `mysql2/promise` `Pool` to the shape the PoolManager and executor
 * expect. `connect()` proves connectivity by checking a connection out and
 * back in. A raw connection whose server side dies emits `error`; a listener is
 * attached to every connection so a checked-out one cannot crash the process
 * (the executor sees the failure through the query itself).
 */
export class MysqlPool extends EventEmitter implements MysqlPoolLike {
    connected = false;
    connecting = false;
    private readonly pool: mysql.Pool;
    private readonly endTimeoutMs: number;

    constructor(config: mysql.PoolOptions, options: MysqlPoolOptions = {}) {
        super();
        this.endTimeoutMs = options.endTimeoutMs ?? 3000;
        this.pool = (options.createDriverPool ?? ((c) => mysql.createPool(c)))(config);
        this.pool.on('connection', (connection) => {
            connection.on('error', () => undefined);
        });
    }

    async connect(): Promise<this> {
        this.connecting = true;
        try {
            const connection = await this.pool.getConnection();
            connection.release();
            this.connected = true;
            return this;
        } finally {
            this.connecting = false;
        }
    }

    /**
     * Ends the pool, but never waits longer than `endTimeoutMs`: a pool whose
     * sockets are already dead must not block the manager from reconnecting.
     */
    async close(): Promise<void> {
        this.connected = false;
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, this.endTimeoutMs);
            timer.unref();
        });
        try {
            await Promise.race([this.pool.end().catch(() => undefined), timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    async acquire(): Promise<MysqlConnectionLike> {
        const connection = await this.pool.getConnection();
        return {
            query: (options: MysqlQueryOptions) =>
                (
                    connection.connection as unknown as {
                        query: (o: MysqlQueryOptions) => MysqlQueryLike;
                    }
                ).query(options),
            release: (destroy: boolean) => (destroy ? connection.destroy() : connection.release()),
            threadId: connection.connection.threadId,
        };
    }
}

/** Pool factory used by the PoolManager in production. */
export const createMysqlPool =
    (config: Config) =>
    (database: string | undefined): MysqlPoolLike =>
        new MysqlPool(toMysqlConfig(config, database));
