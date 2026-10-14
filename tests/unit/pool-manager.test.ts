import { describe, expect, it } from 'vitest';
import { PoolManager } from '../../src/sql/pool-manager.js';
import { FakePoolFactory } from '../helpers/fake-pool.js';

const connectionError = (): Error =>
    Object.assign(new Error('Connection is closed.'), { code: 'ECONNCLOSED' });
const sqlError = (): Error =>
    Object.assign(new Error("Invalid object name 'x'."), { code: 'EREQUEST' });

const setup = () => {
    const factory = new FakePoolFactory();
    const logs: string[] = [];
    const manager = new PoolManager({ createPool: factory.create, log: (m) => logs.push(m) });
    return { factory, logs, manager };
};

describe('PoolManager.getPool', () => {
    it('connects on first use and reuses the pool while it is healthy', async () => {
        const { factory, manager } = setup();

        const first = await manager.getPool('Sales');
        const second = await manager.getPool('Sales');

        expect(second).toBe(first);
        expect(factory.pools).toHaveLength(1);
        expect(first.connectCalls).toBe(1);
    });

    it('does not cache a pool whose connect failed, so the next call tries again', async () => {
        const { factory, manager } = setup();
        factory.nextOptions = { failConnect: connectionError() };

        await expect(manager.getPool('Sales')).rejects.toThrow('Connection is closed');
        const recovered = await manager.getPool('Sales');

        expect(factory.pools).toHaveLength(2);
        expect(recovered.connected).toBe(true);
        expect(factory.pools[0]?.closed).toBe(true);
    });

    it('replaces a pool that reports itself disconnected', async () => {
        const { factory, manager } = setup();
        const first = await manager.getPool('Sales');

        first.drop();
        const second = await manager.getPool('Sales');

        expect(second).not.toBe(first);
        expect(first.closed).toBe(true);
        expect(second.connected).toBe(true);
        expect(factory.pools).toHaveLength(2);
    });

    it('collapses concurrent first calls onto one connect attempt', async () => {
        const { factory, manager } = setup();
        factory.nextOptions = { connectDelayMs: 10 };

        const [a, b, c] = await Promise.all([
            manager.getPool('Sales'),
            manager.getPool('Sales'),
            manager.getPool('Sales'),
        ]);

        expect(factory.pools).toHaveLength(1);
        expect(a).toBe(b);
        expect(b).toBe(c);
    });

    it('discards a pool that emits an error so the next call reconnects', async () => {
        const { factory, manager, logs } = setup();
        const first = await manager.getPool('Sales');

        first.emit('error', connectionError());
        const second = await manager.getPool('Sales');

        expect(second).not.toBe(first);
        expect(factory.pools).toHaveLength(2);
        expect(logs.some((line) => line.includes('discard'))).toBe(true);
    });

    it('ignores a late error from a pool that was already replaced', async () => {
        const { factory, manager } = setup();
        const first = await manager.getPool('Sales');
        first.drop();
        const second = await manager.getPool('Sales');

        first.emit('error', connectionError());
        const third = await manager.getPool('Sales');

        expect(third).toBe(second);
        expect(factory.pools).toHaveLength(2);
    });

    it('keeps one pool per database', async () => {
        const { factory, manager } = setup();

        const sales = await manager.getPool('Sales');
        const archive = await manager.getPool('Archive');

        expect(sales).not.toBe(archive);
        expect(factory.pools.map((p) => p.database)).toEqual(['Sales', 'Archive']);
    });

    it('treats undefined database as its own key (server default database)', async () => {
        const { factory, manager } = setup();

        await manager.getPool(undefined);
        await manager.getPool(undefined);

        expect(factory.pools).toHaveLength(1);
    });
});

describe('PoolManager.withRetry', () => {
    it('runs the operation against a healthy pool', async () => {
        const { manager } = setup();

        const result = await manager.withRetry('Sales', async (pool) => pool.database);

        expect(result).toBe('Sales');
    });

    it('retries once on a connection error using a fresh pool', async () => {
        const { factory, manager } = setup();
        let attempts = 0;

        const result = await manager.withRetry('Sales', async () => {
            attempts++;
            if (attempts === 1) {
                throw connectionError();
            }
            return 'ok';
        });

        expect(result).toBe('ok');
        expect(attempts).toBe(2);
        expect(factory.pools).toHaveLength(2);
        expect(factory.pools[0]?.closed).toBe(true);
    });

    it('does not retry SQL errors', async () => {
        const { factory, manager } = setup();
        let attempts = 0;

        await expect(
            manager.withRetry('Sales', async () => {
                attempts++;
                throw sqlError();
            }),
        ).rejects.toThrow('Invalid object name');

        expect(attempts).toBe(1);
        expect(factory.pools).toHaveLength(1);
    });

    it('gives up after the single retry and surfaces the second connection error', async () => {
        const { manager } = setup();
        let attempts = 0;

        await expect(
            manager.withRetry('Sales', async () => {
                attempts++;
                throw connectionError();
            }),
        ).rejects.toThrow('Connection is closed');

        expect(attempts).toBe(2);
    });

    it('surfaces a connect failure during the retry instead of looping', async () => {
        const { factory, manager } = setup();
        await manager.getPool('Sales');
        factory.nextOptions = {
            failConnect: Object.assign(new Error('Failed to connect to db:1433 in 8000ms'), {
                code: 'ETIMEOUT',
            }),
        };

        await expect(
            manager.withRetry('Sales', async () => {
                throw connectionError();
            }),
        ).rejects.toThrow('Failed to connect');
    });
});

describe('PoolManager.closeAll', () => {
    it('closes every pool and forgets them', async () => {
        const { factory, manager } = setup();
        await manager.getPool('Sales');
        await manager.getPool('Archive');

        await manager.closeAll();
        await manager.getPool('Sales');

        expect(factory.pools.slice(0, 2).every((pool) => pool.closed)).toBe(true);
        expect(factory.pools).toHaveLength(3);
    });

    it('swallows close failures so shutdown always completes', async () => {
        const { manager } = setup();
        const pool = await manager.getPool('Sales');
        pool.close = async () => {
            throw new Error('already closing');
        };

        await expect(manager.closeAll()).resolves.toBeUndefined();
    });
});

describe('PoolManager.describe', () => {
    it('reports whether a database currently has a live pool', async () => {
        const { manager } = setup();
        expect(manager.describe('Sales')).toEqual({ connected: false, connecting: false });

        await manager.getPool('Sales');

        expect(manager.describe('Sales')).toEqual({ connected: true, connecting: false });
    });
});
