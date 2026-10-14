import { EventEmitter } from 'node:events';
import pg from 'pg';
import Cursor from 'pg-cursor';
import type { Config } from '../config.js';
import type { PgClientLike, PgCursorLike, PgPoolLike } from './executor.js';

const INT8_OID = 20;

const parseInt8 = (value: string): number | string => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : value;
};

/**
 * pg returns `bigint` as strings because they may exceed 2^53. Ids and counts
 * are bigint everywhere in PostgreSQL, so values that fit a JavaScript number
 * are returned as numbers and only larger ones stay strings. `numeric` is
 * left as a string to preserve precision.
 */
export const resultTypes: pg.CustomTypesConfig = {
    getTypeParser: (oid, format) =>
        oid === INT8_OID && format !== 'binary'
            ? parseInt8
            : (pg.types.getTypeParser(oid as never, format as never) as (value: string) => unknown),
};

/** Maps our configuration onto the pg driver's pool config for one database. */
export const toPgConfig = (config: Config, database: string | undefined): pg.PoolConfig => ({
    host: config.server,
    port: config.port,
    user: config.user,
    password: config.password,
    ...(database ? { database } : {}),
    ssl: config.ssl,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    statement_timeout: config.requestTimeoutMs,
    query_timeout: config.requestTimeoutMs,
    max: config.poolMax,
    min: 0,
    idleTimeoutMillis: 30000,
    allowExitOnIdle: true,
    application_name: config.applicationName,
    types: resultTypes,
});

/**
 * Adapts `pg.Pool` to the shape the PoolManager and executor expect. `connect()`
 * proves connectivity by checking a client out and back in; a pool `error`
 * (an idle client dying, typically after a network drop) flips `connected` off
 * and is re-emitted so the manager discards the pool.
 */
export type PgPoolOptions = {
    /** Builds the driver pool; tests inject a fake. Defaults to `new pg.Pool(config)`. */
    createDriverPool?: (config: pg.PoolConfig) => pg.Pool;
    /** How long `close()` waits for `pool.end()` before giving up. Default 3000 ms. */
    endTimeoutMs?: number;
};

export class PgPool extends EventEmitter implements PgPoolLike {
    connected = false;
    connecting = false;
    private readonly pool: pg.Pool;
    private readonly endTimeoutMs: number;

    constructor(config: pg.PoolConfig, options: PgPoolOptions = {}) {
        super();
        this.endTimeoutMs = options.endTimeoutMs ?? 3000;
        this.pool = (options.createDriverPool ?? ((c) => new pg.Pool(c)))(config);
        // pg only guards idle clients. A checked-out (or ending) client whose
        // backend dies emits `error` with no listener, which would crash the
        // process and leave `pool.end()` hanging; the executor reads the
        // failure from the query itself.
        this.pool.on('connect', (client) => {
            client.on('error', () => undefined);
        });
        this.pool.on('error', (error) => {
            this.connected = false;
            this.emit('error', error);
        });
    }

    async connect(): Promise<this> {
        this.connecting = true;
        try {
            const client = await this.pool.connect();
            client.release();
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

    async acquire(): Promise<PgClientLike> {
        return (await this.pool.connect()) as unknown as PgClientLike;
    }

    createCursor(sql: string, values: unknown[]): PgCursorLike {
        return new Cursor(sql, values) as unknown as PgCursorLike;
    }
}

/** Pool factory used by the PoolManager in production. */
export const createPgPool =
    (config: Config) =>
    (database: string | undefined): PgPoolLike =>
        new PgPool(toPgConfig(config, database));
