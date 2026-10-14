import { isConnectionError } from './errors.js';

/**
 * The subset of `mssql.ConnectionPool` the manager relies on. Expressed as an
 * interface so tests can drive the manager with a fake and so the driver can be
 * swapped without touching the recovery logic.
 */
export interface PoolLike {
    readonly connected: boolean;
    readonly connecting: boolean;
    connect(): Promise<unknown>;
    close(): Promise<unknown>;
    on(event: 'error', listener: (error: unknown) => void): unknown;
}

export type PoolManagerOptions<TPool extends PoolLike> = {
    createPool: (database: string | undefined) => TPool;
    log?: (message: string) => void;
};

export type PoolState = {
    connected: boolean;
    connecting: boolean;
};

const DEFAULT_KEY = '\u0000default';

const keyFor = (database: string | undefined): string => database ?? DEFAULT_KEY;

const closeQuietly = async (pool: PoolLike): Promise<void> => {
    try {
        await pool.close();
    } catch {
        // A pool that cannot close is already gone; nothing else to do.
    }
};

/**
 * Keeps one connection pool per database and heals it automatically.
 *
 * Failure modes handled, each of which leaves naive implementations stuck until
 * the process restarts:
 *  - a failed `connect()` is never cached, so the next call tries again;
 *  - a pool that reports `connected === false` (network dropped, VPN down) is
 *    closed and replaced on the next call;
 *  - a pool `error` event discards that pool, and a late event from a pool that
 *    was already replaced is ignored;
 *  - concurrent first calls share one connect attempt instead of racing;
 *  - {@link withRetry} runs an operation and retries exactly once on a
 *    connection-level error, against a freshly created pool.
 */
export class PoolManager<TPool extends PoolLike = PoolLike> {
    private readonly pools = new Map<string, TPool>();
    private readonly pending = new Map<string, Promise<TPool>>();
    private readonly createPool: (database: string | undefined) => TPool;
    private readonly log: (message: string) => void;

    constructor(options: PoolManagerOptions<TPool>) {
        this.createPool = options.createPool;
        this.log = options.log ?? (() => undefined);
    }

    /** Returns a connected pool for the database, creating or replacing one as needed. */
    async getPool(database: string | undefined): Promise<TPool> {
        const key = keyFor(database);
        const existing = this.pools.get(key);
        if (existing?.connected) {
            return existing;
        }

        const inFlight = this.pending.get(key);
        if (inFlight) {
            return inFlight;
        }

        const attempt = this.connectFresh(key, database, existing);
        this.pending.set(key, attempt);
        try {
            return await attempt;
        } finally {
            this.pending.delete(key);
        }
    }

    /**
     * Runs `operation` against the database's pool. A connection-level failure
     * discards the pool and retries once on a new one; SQL errors propagate as-is.
     */
    async withRetry<T>(
        database: string | undefined,
        operation: (pool: TPool) => Promise<T>,
    ): Promise<T> {
        const first = await this.getPool(database);
        try {
            return await operation(first);
        } catch (error) {
            if (!isConnectionError(error)) {
                throw error;
            }
            await this.discard(database, first, 'connection error during query');
            const second = await this.getPool(database);
            return operation(second);
        }
    }

    /** Closes and forgets the given pool if it is still the one in use. */
    async discard(database: string | undefined, pool: TPool, reason: string): Promise<void> {
        const key = keyFor(database);
        const isCurrent = this.pools.get(key) === pool;
        if (!isCurrent) {
            return;
        }
        this.pools.delete(key);
        this.log(`pool for ${database ?? '<default>'} discarded (${reason}); next call reconnects`);
        await closeQuietly(pool);
    }

    /** Closes every pool. Never throws, so it is safe during shutdown. */
    async closeAll(): Promise<void> {
        const pools = [...this.pools.values()];
        this.pools.clear();
        await Promise.all(pools.map(closeQuietly));
    }

    /** Current state of a database's pool without triggering a connect. */
    describe(database: string | undefined): PoolState {
        const pool = this.pools.get(keyFor(database));
        return {
            connected: pool?.connected ?? false,
            connecting: pool?.connecting ?? this.pending.has(keyFor(database)),
        };
    }

    private async connectFresh(
        key: string,
        database: string | undefined,
        stale: TPool | undefined,
    ): Promise<TPool> {
        if (stale) {
            this.pools.delete(key);
            this.log(`pool for ${database ?? '<default>'} no longer connected; replacing it`);
            await closeQuietly(stale);
        }

        const pool = this.createPool(database);
        pool.on('error', (error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`pool error for ${database ?? '<default>'}: ${message}`);
            void this.discard(database, pool, 'pool error event');
        });

        try {
            await pool.connect();
        } catch (error) {
            await closeQuietly(pool);
            throw error;
        }

        this.pools.set(key, pool);
        return pool;
    }
}
