import { EventEmitter } from 'node:events';
import oracledb, { type Metadata, type Pool, type PoolAttributes } from 'oracledb';
import type { Config } from '../config.js';
import type { OracleConnectionLike, OraclePoolLike } from './executor.js';

/** Maps our configuration onto the driver's pool attributes. */
export const toPoolAttributes = (config: Config): PoolAttributes => ({
    connectString: config.connectString,
    connectTimeout: Math.max(1, Math.round(config.connectionTimeoutMs / 1000)),
    enableStatistics: false,
    homogeneous: true,
    password: config.password,
    poolIncrement: 1,
    poolMax: config.poolMax,
    poolMin: 0,
    poolTimeout: 60,
    queueTimeout: config.connectionTimeoutMs,
    stmtCacheSize: 30,
    user: config.user,
    ...(config.wallet
        ? {
              configDir: config.wallet.location,
              walletLocation: config.wallet.location,
              ...(config.wallet.password ? { walletPassword: config.wallet.password } : {}),
          }
        : {}),
});

/**
 * LOBs come back as strings/buffers instead of stream handles so a row is
 * plain data; everything else keeps the driver's default JavaScript type.
 */
export const fetchTypeHandler = (
    column: Metadata,
): { type: typeof oracledb.DB_TYPE_VARCHAR } | undefined => {
    const name = column.dbType?.name ?? column.dbTypeName ?? '';
    if (/CLOB|NCLOB/i.test(name)) {
        return { type: oracledb.DB_TYPE_VARCHAR };
    }
    if (/BLOB/i.test(name)) {
        return { type: oracledb.DB_TYPE_RAW };
    }
    return undefined;
};

export type OraclePoolOptions = {
    /** Builds the driver pool; tests inject a fake. Defaults to `oracledb.createPool`. */
    createDriverPool?: (attributes: PoolAttributes) => Promise<Pool>;
    /** How long `close()` waits for `pool.close()` before giving up. Default 3000 ms. */
    endTimeoutMs?: number;
    /** Applied to every checked-out connection. */
    requestTimeoutMs: number;
};

type DriverConnection = Awaited<ReturnType<Pool['getConnection']>>;

/**
 * Adapts `oracledb.Pool` to the shape the PoolManager and executor expect.
 * `connect()` creates the pool and proves connectivity by checking a connection
 * out and back in. Connection-level failures surface through queries (the
 * manager discards the pool and retries), so the pool itself has no error event.
 */
export class OraclePool extends EventEmitter implements OraclePoolLike {
    connected = false;
    connecting = false;
    private pool: Pool | undefined;
    private readonly createDriverPool: (attributes: PoolAttributes) => Promise<Pool>;
    private readonly endTimeoutMs: number;

    constructor(
        private readonly attributes: PoolAttributes,
        private readonly options: OraclePoolOptions,
    ) {
        super();
        this.createDriverPool = options.createDriverPool ?? ((a) => oracledb.createPool(a));
        this.endTimeoutMs = options.endTimeoutMs ?? 3000;
    }

    async connect(): Promise<this> {
        this.connecting = true;
        try {
            const pool = await this.createDriverPool(this.attributes);
            try {
                const connection = await pool.getConnection();
                await connection.close();
            } catch (error) {
                await pool.close(0).catch(() => undefined);
                throw error;
            }
            this.pool = pool;
            this.connected = true;
            return this;
        } finally {
            this.connecting = false;
        }
    }

    /** Closes the pool, forcing open connections shut, but never waits longer than `endTimeoutMs`. */
    async close(): Promise<void> {
        this.connected = false;
        const pool = this.pool;
        this.pool = undefined;
        if (!pool) {
            return;
        }
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, this.endTimeoutMs);
            timer.unref();
        });
        try {
            await Promise.race([pool.close(0).catch(() => undefined), timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    async acquire(): Promise<OracleConnectionLike> {
        if (!this.pool) {
            throw new Error('Pool is not connected.');
        }
        const connection = await this.pool.getConnection();
        connection.callTimeout = this.options.requestTimeoutMs;
        return wrapConnection(connection);
    }
}

/** Adds the LOB type handler and ARRAY output to every execute call. */
const wrapConnection = (connection: DriverConnection): OracleConnectionLike => ({
    get callTimeout() {
        return connection.callTimeout;
    },
    set callTimeout(value: number) {
        connection.callTimeout = value;
    },
    // The driver validates argument counts: close(undefined) is rejected and would leak the connection.
    close: (options) => (options ? connection.close(options) : connection.close()),
    execute: (sql, binds, options) =>
        connection.execute(sql, binds, {
            ...options,
            fetchTypeHandler,
            outFormat: oracledb.OUT_FORMAT_ARRAY,
        }),
    rollback: () => connection.rollback(),
});

/** Pool factory used by the PoolManager in production. */
export const createOraclePool =
    (config: Config) =>
    (_database: string | undefined): OraclePoolLike =>
        new OraclePool(toPoolAttributes(config), { requestTimeoutMs: config.requestTimeoutMs });
