import {
    AbortedError,
    isConnectionError,
    type ColumnInfo,
    type ExecutorDefaults,
    type IQueryExecutor,
    type PoolLike,
    type PoolManager,
    type QueryResult,
    type RunOptions,
} from '@qodalis/mcp-sql-core';
import type { BindParameters, Metadata } from 'oracledb';
import { splitStatements, toBindParams } from './params.js';
import { normalizeCell, typeNameFor } from './types.js';

export type {
    ColumnInfo,
    ExecutorDefaults,
    IQueryExecutor,
    QueryResult,
    RunOptions,
} from '@qodalis/mcp-sql-core';
export { AbortedError } from '@qodalis/mcp-sql-core';

/** The slice of an `oracledb` result set used here. */
export interface OracleResultSetLike {
    close(): Promise<void>;
    getRows(numRows: number): Promise<unknown[][]>;
    metaData: Metadata[];
}

export type OracleExecuteResult = {
    metaData?: Metadata[] | undefined;
    resultSet?: OracleResultSetLike | undefined;
    rowsAffected?: number | undefined;
};

export type OracleExecuteOptions = {
    autoCommit: boolean;
    fetchArraySize: number;
    resultSet: true;
};

/** The slice of a checked-out `oracledb` connection used here. */
export interface OracleConnectionLike {
    callTimeout: number;
    close(options?: { drop?: boolean }): Promise<void>;
    execute(
        sql: string,
        binds: BindParameters,
        options: OracleExecuteOptions,
    ): Promise<OracleExecuteResult>;
    rollback(): Promise<void>;
}

/** A pool the executor can draw connections from; implemented by {@link OraclePool}. */
export interface OraclePoolLike extends PoolLike {
    acquire(): Promise<OracleConnectionLike>;
}

export type OracleExecutorDefaults = ExecutorDefaults & {
    /** Statements run without autocommit and are rolled back at the end when true. */
    readOnly: boolean;
};

const BATCH_SIZE = 200;

const toColumns = (metaData: Metadata[] | undefined): ColumnInfo[] =>
    (metaData ?? []).map((column) => ({
        name: column.name,
        nullable: column.nullable ?? true,
        type: typeNameFor(column),
    }));

type Partial = Omit<QueryResult, 'durationMs' | 'messages'>;

/**
 * Executes SQL through the pool manager. Every call checks a connection out,
 * runs the statements of the batch on it in order (Oracle has no batch
 * protocol), streams the last result set through a server-side cursor with a
 * hard row cap, and returns the connection. In read-only mode nothing is
 * committed: the connection is rolled back before it goes back to the pool.
 */
export class OracleExecutor implements IQueryExecutor {
    constructor(
        private readonly manager: PoolManager<OraclePoolLike>,
        private readonly defaults: OracleExecutorDefaults,
    ) {}

    run(options: RunOptions): Promise<QueryResult> {
        return this.manager.withRetry(options.database, (pool) => this.runOnPool(pool, options));
    }

    private async runOnPool(pool: OraclePoolLike, options: RunOptions): Promise<QueryResult> {
        const maxRows = options.maxRows ?? this.defaults.maxRows;
        const statements = splitStatements(options.sql);
        const hasParams = Boolean(options.params && Object.keys(options.params).length > 0);
        if (statements.length > 1 && hasParams) {
            throw new Error(
                'Parameters can only be used with a single statement; split the batch or inline the values.',
            );
        }
        if (options.signal?.aborted) {
            throw new AbortedError();
        }
        const started = Date.now();
        const connection = await pool.acquire();
        let drop = false;
        try {
            const partial = await this.runStatements(connection, statements, options, maxRows);
            return { ...partial, durationMs: Date.now() - started, messages: [] };
        } catch (error) {
            drop = error instanceof AbortedError || isConnectionError(error);
            throw error;
        } finally {
            await this.release(connection, drop);
        }
    }

    private async release(connection: OracleConnectionLike, drop: boolean): Promise<void> {
        if (!drop && this.defaults.readOnly) {
            try {
                await connection.rollback();
            } catch {
                drop = true;
            }
        }
        try {
            await (drop ? connection.close({ drop: true }) : connection.close());
        } catch {
            // Returning it failed; make sure it is at least not leaked.
            await connection.close({ drop: true }).catch(() => undefined);
        }
    }

    private async runStatements(
        connection: OracleConnectionLike,
        statements: string[],
        options: RunOptions,
        maxRows: number,
    ): Promise<Partial> {
        const rowsAffected: number[] = [];
        let last: Partial = { columns: [], rowCount: 0, rows: [], rowsAffected, truncated: false };
        for (const statement of statements) {
            const { sql, binds } = toBindParams(statement, options.params);
            const result = await connection.execute(sql, binds, {
                autoCommit: !this.defaults.readOnly,
                fetchArraySize: BATCH_SIZE,
                resultSet: true,
            });
            if (result.resultSet) {
                last = await this.drain(result.resultSet, maxRows, options.signal);
                last = { ...last, rowsAffected };
                continue;
            }
            if (typeof result.rowsAffected === 'number') {
                rowsAffected.push(result.rowsAffected);
            }
            last = { columns: [], rowCount: 0, rows: [], rowsAffected, truncated: false };
        }
        return last;
    }

    /** Reads batches until the row cap or the end; the cursor is always closed. */
    private async drain(
        resultSet: OracleResultSetLike,
        maxRows: number,
        signal: AbortSignal | undefined,
    ): Promise<Partial> {
        const columns = toColumns(resultSet.metaData);
        const rows: unknown[][] = [];
        let truncated = false;
        try {
            while (!truncated) {
                if (signal?.aborted) {
                    throw new AbortedError();
                }
                const want = Math.min(BATCH_SIZE, maxRows - rows.length + 1);
                const batch = await resultSet.getRows(want);
                for (const row of batch) {
                    if (rows.length < maxRows) {
                        rows.push(row.map(normalizeCell));
                    }
                }
                if (batch.length < want) {
                    break;
                }
                truncated = rows.length >= maxRows;
            }
        } finally {
            await resultSet.close().catch(() => undefined);
        }
        return { columns, rowCount: rows.length, rows, rowsAffected: [], truncated };
    }
}
