import { describe, expect, it } from 'vitest';
import oracledb from 'oracledb';
import { loadConfig } from '../../src/config.js';
import { fetchTypeHandler, OraclePool, toPoolAttributes } from '../../src/sql/oracle-pool.js';

const config = loadConfig({
    ORACLE_HOST: 'db.example.com',
    ORACLE_PORT: '1522',
    ORACLE_USER: 'reader',
    ORACLE_PASSWORD: 'secret',
    ORACLE_SERVICE: 'svc',
    ORACLE_CONNECTION_TIMEOUT: '5000',
    ORACLE_REQUEST_TIMEOUT: '7000',
    ORACLE_POOL_MAX: '4',
});

describe('toPoolAttributes', () => {
    it('maps connection, timeout and pool settings onto the driver attributes', () => {
        expect(toPoolAttributes(config)).toMatchObject({
            connectString: 'db.example.com:1522/svc',
            user: 'reader',
            password: 'secret',
            poolMax: 4,
            poolMin: 0,
            connectTimeout: 5,
            queueTimeout: 5000,
            homogeneous: true,
        });
        expect(toPoolAttributes(config)).not.toHaveProperty('walletLocation');
    });

    it('passes wallet settings through', () => {
        const attributes = toPoolAttributes({
            ...config,
            wallet: { location: '/w', password: 'wp' },
        });
        expect(attributes).toMatchObject({
            configDir: '/w',
            walletLocation: '/w',
            walletPassword: 'wp',
        });
    });
});

describe('fetchTypeHandler', () => {
    it('inlines CLOBs as strings and BLOBs as raw buffers, leaves other types alone', () => {
        expect(fetchTypeHandler({ name: 'C', dbType: oracledb.DB_TYPE_CLOB })).toEqual({
            type: oracledb.DB_TYPE_VARCHAR,
        });
        expect(fetchTypeHandler({ name: 'B', dbTypeName: 'BLOB' })).toEqual({
            type: oracledb.DB_TYPE_RAW,
        });
        expect(fetchTypeHandler({ name: 'N', dbTypeName: 'NUMBER' })).toBeUndefined();
    });
});

type Conn = {
    callTimeout: number;
    closed: Array<{ drop?: boolean } | 'no-args'>;
    close: (...args: unknown[]) => Promise<void>;
    execute: (...a: unknown[]) => Promise<unknown>;
    rollback: () => Promise<void>;
};

class FakeDriverPool {
    connections: Conn[] = [];
    closeCalls: number[] = [];
    closeHangs = false;
    connectError: Error | undefined;
    executeArgs: unknown[] = [];
    status = 0;

    async getConnection(): Promise<Conn> {
        if (this.connectError) {
            throw this.connectError;
        }
        const conn: Conn = {
            callTimeout: 0,
            closed: [],
            // oracledb counts arguments: close(undefined) throws NJS-009, so the fake records the arity.
            close: async (...args: unknown[]) => {
                conn.closed.push(args.length === 0 ? 'no-args' : (args[0] as { drop?: boolean }));
            },
            execute: async (...args: unknown[]) => {
                this.executeArgs = args;
                return { rowsAffected: 1 };
            },
            rollback: async () => undefined,
        };
        this.connections.push(conn);
        return conn;
    }

    close(drainTime?: number): Promise<void> {
        this.closeCalls.push(drainTime ?? -1);
        return this.closeHangs ? new Promise(() => undefined) : Promise.resolve();
    }
}

describe('OraclePool', () => {
    const make = (endTimeoutMs = 50) => {
        const driver = new FakeDriverPool();
        const pool = new OraclePool(toPoolAttributes(config), {
            createDriverPool: async () => driver as never,
            endTimeoutMs,
            requestTimeoutMs: 7000,
        });
        return { driver, pool };
    };

    it('reports connected only after a connection was checked out and returned', async () => {
        const { driver, pool } = make();
        expect(pool.connected).toBe(false);

        await pool.connect();

        expect(pool.connected).toBe(true);
        expect(pool.connecting).toBe(false);
        expect(driver.connections[0]?.closed).toEqual(['no-args']);
    });

    it('does not report connected and closes the half-built pool when the probe fails', async () => {
        const { driver, pool } = make();
        driver.connectError = Object.assign(new Error('ORA-12541: no listener'), {
            code: 'ORA-12541',
        });

        await expect(pool.connect()).rejects.toThrow(/ORA-12541/);
        expect(pool.connected).toBe(false);
        expect(driver.closeCalls).toEqual([0]);
    });

    it('acquire() applies the request timeout and adds ARRAY output plus the LOB handler to execute', async () => {
        const { driver, pool } = make();
        await pool.connect();

        const connection = await pool.acquire();
        await connection.execute(
            'select 1 from dual',
            {},
            { autoCommit: false, fetchArraySize: 10, resultSet: true },
        );

        expect(connection.callTimeout).toBe(7000);
        expect(driver.executeArgs[2]).toMatchObject({
            outFormat: oracledb.OUT_FORMAT_ARRAY,
            resultSet: true,
            fetchArraySize: 10,
        });
        expect(
            typeof (driver.executeArgs[2] as { fetchTypeHandler: unknown }).fetchTypeHandler,
        ).toBe('function');
    });

    it('returns a connection with no close() arguments and drops it with { drop: true }', async () => {
        const { driver, pool } = make();
        await pool.connect();

        const first = await pool.acquire();
        await first.close();
        const second = await pool.acquire();
        await second.close({ drop: true });

        expect(driver.connections[1]?.closed).toEqual(['no-args']);
        expect(driver.connections[2]?.closed).toEqual([{ drop: true }]);
    });

    it('acquire() fails clearly before connect()', async () => {
        const { pool } = make();
        await expect(pool.acquire()).rejects.toThrow(/not connected/);
    });

    it('close() force-closes the driver pool and never waits longer than the end timeout', async () => {
        const { driver, pool } = make(20);
        await pool.connect();
        driver.closeHangs = true;
        const started = Date.now();

        await pool.close();

        expect(driver.closeCalls).toEqual([0]);
        expect(pool.connected).toBe(false);
        expect(Date.now() - started).toBeLessThan(1000);
        await expect(pool.acquire()).rejects.toThrow(/not connected/);
    });

    it('close() is a no-op before connect()', async () => {
        const { driver, pool } = make();
        await pool.close();
        expect(driver.closeCalls).toEqual([]);
    });
});
