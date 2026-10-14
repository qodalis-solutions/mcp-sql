import { EventEmitter } from 'node:events';
import type { PoolLike } from '../../src/sql/pool-manager.js';

export type FakePoolOptions = {
    failConnect?: Error;
    connectDelayMs?: number;
};

/** Minimal stand-in for an mssql ConnectionPool with controllable health. */
export class FakePool extends EventEmitter implements PoolLike {
    connected = false;
    connecting = false;
    closed = false;
    connectCalls = 0;
    readonly database: string | undefined;

    constructor(
        database: string | undefined,
        private readonly options: FakePoolOptions = {},
    ) {
        super();
        this.database = database;
    }

    async connect(): Promise<this> {
        this.connectCalls++;
        this.connecting = true;
        if (this.options.connectDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, this.options.connectDelayMs));
        }
        this.connecting = false;
        if (this.options.failConnect) {
            throw this.options.failConnect;
        }
        this.connected = true;
        return this;
    }

    async close(): Promise<void> {
        this.closed = true;
        this.connected = false;
    }

    /** Simulates the network going away under the pool. */
    drop(): void {
        this.connected = false;
    }

    request(): never {
        throw new Error('FakePool.request is not used by pool-manager tests');
    }
}

export class FakePoolFactory {
    readonly pools: FakePool[] = [];
    nextOptions: FakePoolOptions = {};

    create = (database: string | undefined): FakePool => {
        const pool = new FakePool(database, this.nextOptions);
        this.nextOptions = {};
        this.pools.push(pool);
        return pool;
    };
}
