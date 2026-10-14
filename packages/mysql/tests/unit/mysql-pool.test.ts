import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { MysqlPool, toMysqlConfig } from '../../src/sql/mysql-pool.js';

const config = loadConfig({
    MYSQL_HOST: 'db.example.com',
    MYSQL_PORT: '3307',
    MYSQL_USER: 'reader',
    MYSQL_PASSWORD: 'secret',
    MYSQL_DATABASE: 'sales',
    MYSQL_CONNECTION_TIMEOUT: '5000',
    MYSQL_POOL_MAX: '4',
    MYSQL_SSL: 'require',
});

describe('toMysqlConfig', () => {
    it('maps connection, ssl, timeout and pool settings onto the mysql2 config', () => {
        expect(toMysqlConfig(config, 'sales')).toMatchObject({
            host: 'db.example.com',
            port: 3307,
            user: 'reader',
            password: 'secret',
            database: 'sales',
            ssl: { rejectUnauthorized: false },
            connectTimeout: 5000,
            connectionLimit: 4,
            waitForConnections: true,
            multipleStatements: true,
            namedPlaceholders: false,
            supportBigNumbers: true,
            bigNumberStrings: false,
            decimalNumbers: false,
            timezone: 'Z',
        });
    });

    it('overrides the database per pool and omits it when undefined', () => {
        expect(toMysqlConfig(config, 'archive').database).toBe('archive');
        expect(toMysqlConfig(config, undefined)).not.toHaveProperty('database');
    });

    it('omits ssl entirely when it is off', () => {
        expect(toMysqlConfig({ ...config, ssl: false }, 'sales')).not.toHaveProperty('ssl');
    });
});

class FakeRawConnection extends EventEmitter {
    threadId = 7;
    query(): EventEmitter {
        return new EventEmitter();
    }
}

class FakeDriverConnection {
    released = false;
    destroyed = false;
    readonly connection = new FakeRawConnection();
    release(): void {
        this.released = true;
    }
    destroy(): void {
        this.destroyed = true;
    }
}

class FakeDriverPool extends EventEmitter {
    connections: FakeDriverConnection[] = [];
    rawConnections: FakeRawConnection[] = [];
    endCalls = 0;
    endHangs = false;
    connectError: Error | undefined;

    async getConnection(): Promise<FakeDriverConnection> {
        if (this.connectError) {
            throw this.connectError;
        }
        const connection = new FakeDriverConnection();
        this.connections.push(connection);
        this.rawConnections.push(connection.connection);
        this.emit('connection', connection.connection);
        return connection;
    }

    end(): Promise<void> {
        this.endCalls++;
        return this.endHangs ? new Promise(() => undefined) : Promise.resolve();
    }
}

describe('MysqlPool', () => {
    const make = (endTimeoutMs = 50) => {
        const driver = new FakeDriverPool();
        const pool = new MysqlPool(toMysqlConfig(config, 'sales'), {
            createDriverPool: () => driver as never,
            endTimeoutMs,
        });
        return { driver, pool };
    };

    it('reports connected only after a connection was checked out and returned', async () => {
        const { driver, pool } = make();
        expect(pool.connected).toBe(false);

        await pool.connect();

        expect(pool.connected).toBe(true);
        expect(pool.connecting).toBe(false);
        expect(driver.connections[0]?.released).toBe(true);
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

    it('keeps a dying checked-out connection from crashing the process', async () => {
        const { driver, pool } = make();
        await pool.connect();
        await pool.acquire();

        expect(() =>
            driver.rawConnections[1]?.emit('error', new Error('Connection lost')),
        ).not.toThrow();
        expect(driver.rawConnections[1]?.listenerCount('error')).toBe(1);
    });

    it('acquire() hands out a connection whose release(true) destroys it', async () => {
        const { driver, pool } = make();
        const connection = await pool.acquire();

        connection.release(true);
        expect(driver.connections[0]?.destroyed).toBe(true);
        expect(driver.connections[0]?.released).toBe(false);

        const second = await pool.acquire();
        second.release(false);
        expect(driver.connections[1]?.released).toBe(true);
        expect(driver.connections[1]?.destroyed).toBe(false);
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
});
