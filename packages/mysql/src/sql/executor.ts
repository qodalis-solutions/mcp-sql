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
import { toPositionalParams } from './params.js';
import { typeNameForColumn } from './types.js';

export type {
    ColumnInfo,
    ExecutorDefaults,
    IQueryExecutor,
    QueryResult,
    RunOptions,
} from '@qodalis/mcp-sql-core';
export { AbortedError } from '@qodalis/mcp-sql-core';

/** The slice of a mysql2 field packet used here. */
export type MysqlField = {
    columnType?: number;
    flags: number | string[];
    name: string;
    type?: number;
};

export type MysqlQueryOptions = {
    rowsAsArray: true;
    sql: string;
    timeout?: number;
    values: unknown[];
};

/** The streaming query emitter returned by a raw mysql2 connection. */
export interface MysqlQueryLike {
    on(event: 'fields', listener: (fields: MysqlField[], index: number) => void): this;
    on(
        event: 'result',
        listener: (row: unknown[] | { affectedRows: number }, index: number) => void,
    ): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
}

/** A checked-out connection; `release(true)` destroys it instead of returning it. */
export interface MysqlConnectionLike {
    query(options: MysqlQueryOptions): MysqlQueryLike;
    release(destroy: boolean): void;
    threadId: number;
}

/** A pool the executor can draw connections from; implemented by {@link MysqlPool}. */
export interface MysqlPoolLike extends PoolLike {
    acquire(): Promise<MysqlConnectionLike>;
}

export type MysqlExecutorDefaults = ExecutorDefaults & {
    /** Per-query timeout handed to mysql2 (`timeout` option). */
    queryTimeoutMs?: number;
};

const NOT_NULL_FLAG = 1;

const isNotNull = (flags: number | string[]): boolean =>
    Array.isArray(flags) ? flags.includes('NOT_NULL') : (flags & NOT_NULL_FLAG) !== 0;

const toColumns = (fields: MysqlField[]): ColumnInfo[] =>
    fields.map((field) => ({
        name: field.name,
        nullable: !isNotNull(field.flags),
        type: typeNameForColumn(
            field.columnType ?? field.type ?? -1,
            Array.isArray(field.flags) ? 0 : field.flags,
        ),
    }));

const isOkPacket = (row: unknown): row is { affectedRows: number } =>
    typeof row === 'object' && row !== null && !Array.isArray(row) && 'affectedRows' in row;

/**
 * Executes SQL through the pool manager on a streaming mysql2 query. Rows are
 * counted as they arrive; once the cap is exceeded the result is settled and
 * the connection is destroyed rather than returned to the pool, which is the
 * only way to stop the server from sending the rest. Multi-statement batches
 * (`multipleStatements`) stream several result sets: the last one with
 * columns is returned, OK packets contribute `rowsAffected`.
 */
export class MysqlExecutor implements IQueryExecutor {
    constructor(
        private readonly manager: PoolManager<MysqlPoolLike>,
        private readonly defaults: MysqlExecutorDefaults,
    ) {}

    run(options: RunOptions): Promise<QueryResult> {
        return this.manager.withRetry(options.database, (pool) => this.runOnPool(pool, options));
    }

    private async runOnPool(pool: MysqlPoolLike, options: RunOptions): Promise<QueryResult> {
        const maxRows = options.maxRows ?? this.defaults.maxRows;
        const started = Date.now();
        const connection = await pool.acquire();
        let destroy = false;
        try {
            const partial = await this.stream(connection, options, maxRows, () => {
                destroy = true;
            });
            return { ...partial, durationMs: Date.now() - started, messages: [] };
        } catch (error) {
            destroy = destroy || error instanceof AbortedError || isConnectionError(error);
            throw error;
        } finally {
            connection.release(destroy);
        }
    }

    private stream(
        connection: MysqlConnectionLike,
        options: RunOptions,
        maxRows: number,
        markDead: () => void,
    ): Promise<Omit<QueryResult, 'durationMs' | 'messages'>> {
        const { sql, values } = toPositionalParams(options.sql, options.params);
        return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (): boolean => {
                if (settled) {
                    return false;
                }
                settled = true;
                options.signal?.removeEventListener('abort', onAbort);
                return true;
            };
            const onAbort = () => {
                if (settle()) {
                    markDead();
                    reject(new AbortedError());
                }
            };
            if (options.signal?.aborted) {
                onAbort();
                return;
            }
            options.signal?.addEventListener('abort', onAbort, { once: true });

            let columns: ColumnInfo[] = [];
            let rows: unknown[][] = [];
            const rowsAffected: number[] = [];
            const result = (truncated: boolean) => ({
                columns,
                rowCount: rows.length,
                rows,
                rowsAffected,
                truncated,
            });

            const query = connection.query({
                rowsAsArray: true,
                sql,
                values,
                ...(this.defaults.queryTimeoutMs ? { timeout: this.defaults.queryTimeoutMs } : {}),
            });
            // mysql2 emits `fields` with undefined before the OK packet of a non-SELECT statement.
            query.on('fields', (fields) => {
                if (settled || !fields) {
                    return;
                }
                // A later result set replaces the earlier one: the batch's answer is its last SELECT.
                columns = toColumns(fields);
                rows = [];
            });
            // Rows arrive as arrays (rowsAsArray); OK packets of non-SELECT statements as objects.
            query.on('result', (row) => {
                if (settled) {
                    return;
                }
                if (!Array.isArray(row)) {
                    rowsAffected.push(isOkPacket(row) ? row.affectedRows : 0);
                    return;
                }
                if (rows.length >= maxRows) {
                    if (settle()) {
                        markDead();
                        resolve(result(true));
                    }
                    return;
                }
                rows.push(row);
            });
            query.on('end', () => {
                if (settle()) {
                    resolve(result(false));
                }
            });
            query.on('error', (error) => {
                if (settle()) {
                    reject(error);
                }
            });
        });
    }
}
