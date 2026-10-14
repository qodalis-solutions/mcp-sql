import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { PgPool, toPgConfig } from '../../src/sql/pg-pool.js';

const config = loadConfig({
    POSTGRES_HOST: 'db.example.com',
    POSTGRES_PORT: '5433',
    POSTGRES_USER: 'reader',
    POSTGRES_PASSWORD: 'secret',
    POSTGRES_DATABASE: 'sales',
    POSTGRES_CONNECTION_TIMEOUT: '5000',
    POSTGRES_REQUEST_TIMEOUT: '7000',
    POSTGRES_POOL_MAX: '4',
    POSTGRES_APPLICATION_NAME: 'bot',
});

describe('toPgConfig', () => {
    it('maps connection, ssl, timeout and pool settings onto the pg config', () => {
        expect(toPgConfig(config, 'sales')).toMatchObject({
            host: 'db.example.com',
            port: 5433,
            user: 'reader',
            password: 'secret',
            database: 'sales',
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 5000,
            statement_timeout: 7000,
            max: 4,
            application_name: 'bot',
        });
    });

    it('overrides the database per pool and omits it when undefined', () => {
        expect(toPgConfig(config, 'archive').database).toBe('archive');
        expect(toPgConfig(config, undefined)).not.toHaveProperty('database');
    });

    it('passes ssl=false through', () => {
        expect(toPgConfig({ ...config, ssl: false }, 'sales').ssl).toBe(false);
    });

    it('keeps idle clients short-lived so a dropped tunnel is noticed quickly', () => {
        expect(toPgConfig(config, 'sales').idleTimeoutMillis).toBeLessThanOrEqual(30000);
    });

    it('parses int8 as a number when safe and leaves larger values as strings', () => {
        const types = toPgConfig(config, 'sales').types as {
            getTypeParser: (oid: number, format?: string) => (v: string) => unknown;
        };
        const int8 = types.getTypeParser(20, 'text');
        expect(int8('42')).toBe(42);
        expect(int8('-7')).toBe(-7);
        expect(int8('9007199254740993')).toBe('9007199254740993');
        expect(types.getTypeParser(1700, 'text')('15.00')).toBe('15.00');
        expect(types.getTypeParser(23, 'text')('5')).toBe(5);
    });
});

class FakeClient extends EventEmitter {
    released = false;
    release(): void {
        this.released = true;
    }
}

class FakeDriverPool extends EventEmitter {
    clients: FakeClient[] = [];
    endCalls = 0;
    endHangs = false;
    connectError: Error | undefined;

    async connect(): Promise<FakeClient> {
        if (this.connectError) {
            throw this.connectError;
        }
        const client = new FakeClient();
        this.clients.push(client);
        this.emit('connect', client);
        return client;
    }

    end(): Promise<void> {
        this.endCalls++;
        return this.endHangs ? new Promise(() => undefined) : Promise.resolve();
    }
}

describe('PgPool', () => {
    const make = (endTimeoutMs = 50) => {
        const driver = new FakeDriverPool();
        const pool = new PgPool(toPgConfig(config, 'sales'), {
            createDriverPool: () => driver as never,
            endTimeoutMs,
        });
        return { driver, pool };
    };

    it('reports connected only after a client was checked out and returned', async () => {
        const { driver, pool } = make();
        expect(pool.connected).toBe(false);

        await pool.connect();

        expect(pool.connected).toBe(true);
        expect(pool.connecting).toBe(false);
        expect(driver.clients[0]?.released).toBe(true);
    });

    it('does not report connected when the connect fails', async () => {
        const { driver, pool } = make();
        driver.connectError = Object.assign(new Error('connect ECONNREFUSED'), {
            code: 'ECONNREFUSED',
        });

        await expect(pool.connect()).rejects.toThrow(/ECONNREFUSED/);
        expect(pool.connected).toBe(false);
        expect(pool.connecting).toBe(false);
    });

    it('flips connected off and re-emits a driver pool error', async () => {
        const { driver, pool } = make();
        await pool.connect();
        const seen: unknown[] = [];
        pool.on('error', (error) => seen.push(error));

        driver.emit('error', new Error('Connection terminated unexpectedly'));

        expect(pool.connected).toBe(false);
        expect(seen).toHaveLength(1);
    });

    it('keeps a dying checked-out client from crashing the process', async () => {
        const { driver, pool } = make();
        await pool.connect();
        const client = await pool.acquire();

        expect(() =>
            (client as unknown as FakeClient).emit('error', new Error('terminating connection')),
        ).not.toThrow();
        expect(driver.clients[1]?.listenerCount('error')).toBe(1);
    });

    it('close() ends the driver pool and never waits longer than the end timeout', async () => {
        const { driver, pool } = make(20);
        await pool.connect();
        driver.endHangs = true;
        const started = Date.now();

        await pool.close();

        expect(driver.endCalls).toBe(1);
        expect(pool.connected).toBe(false);
        expect(Date.now() - started).toBeLessThan(1000);
    });

    it('createCursor builds a pg-cursor for the sql and values', () => {
        const { pool } = make();
        const cursor = pool.createCursor('select $1', [1]) as unknown as {
            text: string;
            values: unknown[];
        };

        expect(cursor.text).toBe('select $1');
        expect(cursor.values).toEqual(['1']); // pg-cursor prepares values for the wire
    });
});
