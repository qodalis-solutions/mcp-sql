import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import {
    AbortedError,
    type ColumnInfo,
    type ExecutorDefaults,
    type IQueryExecutor,
    type PoolManager,
    type QueryResult,
    type RunOptions,
} from '@qodalis/mcp-sql-core';
import type { SqliteDatabase } from './sqlite-db.js';
import { classifyStatement, splitStatements } from './statements.js';

export type {
    ColumnInfo,
    ExecutorDefaults,
    IQueryExecutor,
    QueryResult,
    RunOptions,
} from '@qodalis/mcp-sql-core';
export { AbortedError } from '@qodalis/mcp-sql-core';

/** SQLite result codes after which the handle is dropped so the next call reopens the file. */
const FILE_ERROR_CODES = new Set([10, 11, 14, 26]); // IOERR, CORRUPT, CANTOPEN, NOTADB

const ABORT_CHECK_EVERY = 256;

type SqliteError = Error & { errcode?: number; errstr?: string };

const typeOfValue = (value: unknown): string => {
    if (value === null || value === undefined) {
        return 'NULL';
    }
    if (typeof value === 'bigint') {
        return 'INTEGER';
    }
    if (typeof value === 'number') {
        return Number.isInteger(value) ? 'INTEGER' : 'REAL';
    }
    if (typeof value === 'string') {
        return 'TEXT';
    }
    return 'BLOB';
};

const toCell = (value: unknown): unknown => {
    if (typeof value === 'bigint') {
        return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(value)
            : value.toString();
    }
    if (value instanceof Uint8Array) {
        return Buffer.from(value);
    }
    return value;
};

const toInput = (value: unknown): SQLInputValue => {
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    if (value === undefined) {
        return null;
    }
    return value as SQLInputValue;
};

/** Only the names the statement actually references are bound, prefixed as SQLite expects. */
const bindParams = (
    sql: string,
    params: Record<string, unknown>,
): Record<string, SQLInputValue> => {
    const referenced = new Set(
        [...sql.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] ?? ''),
    );
    const bound: Record<string, SQLInputValue> = {};
    for (const name of referenced) {
        if (!(name in params)) {
            throw new Error(
                `Parameter @${name} is referenced in the SQL but no value was supplied.`,
            );
        }
        bound[`@${name}`] = toInput(params[name]);
    }
    return bound;
};

const columnsOf = (
    statement: StatementSync,
    firstRow: Record<string, unknown> | undefined,
): ColumnInfo[] => {
    const hasMetadata = typeof statement.columns === 'function';
    if (hasMetadata) {
        return statement.columns().map((column) => ({
            name: column.name,
            nullable: true,
            type: column.type ?? typeOfValue(firstRow?.[column.name]),
        }));
    }
    return Object.keys(firstRow ?? {}).map((name) => ({
        name,
        nullable: true,
        type: typeOfValue(firstRow?.[name]),
    }));
};

const isFileError = (error: unknown): boolean =>
    typeof (error as SqliteError).errcode === 'number' &&
    FILE_ERROR_CODES.has((error as SqliteError).errcode ?? -1);

type Partial = Omit<QueryResult, 'durationMs' | 'messages'>;

/**
 * Runs batches against one SQLite handle. Everything is synchronous in
 * node:sqlite, so the abort signal is polled between statements and every few
 * hundred rows.
 */
export class SqliteExecutor implements IQueryExecutor {
    constructor(
        private readonly manager: PoolManager<SqliteDatabase>,
        private readonly defaults: ExecutorDefaults,
    ) {}

    async run(options: RunOptions): Promise<QueryResult> {
        const started = Date.now();
        const pool = await this.manager.getPool(options.database);
        try {
            const partial = this.runOn(pool.handle, options);
            return { ...partial, durationMs: Date.now() - started, messages: [] };
        } catch (error) {
            if (isFileError(error)) {
                await this.manager.discard(
                    options.database,
                    pool,
                    `file error: ${(error as Error).message}`,
                );
            }
            throw error;
        }
    }

    private runOn(db: DatabaseSync, options: RunOptions): Partial {
        const maxRows = options.maxRows ?? this.defaults.maxRows;
        const statements = splitStatements(options.sql);
        const params = options.params ?? {};
        const hasParams = Object.keys(params).length > 0;
        if (statements.length > 1 && hasParams) {
            throw new Error(
                'Parameters can only be used with a single statement; split the batch or inline the values.',
            );
        }
        if (statements.length === 0) {
            throw new Error('Query is empty.');
        }
        let last: Partial = {
            columns: [],
            rowCount: 0,
            rows: [],
            rowsAffected: [],
            truncated: false,
        };
        const rowsAffected: number[] = [];
        for (const statement of statements) {
            this.throwIfAborted(options.signal);
            const kind = classifyStatement(statement);
            if (kind === 'exec') {
                db.exec(statement);
                continue;
            }
            const prepared = db.prepare(statement);
            prepared.setReadBigInts(true);
            const bound = bindParams(statement, params);
            if (kind === 'changes') {
                const changes = prepared.run(bound).changes;
                rowsAffected.push(typeof changes === 'bigint' ? Number(changes) : changes);
                continue;
            }
            last = this.readRows(prepared, bound, maxRows, options.signal);
        }
        return { ...last, rowsAffected };
    }

    private readRows(
        prepared: StatementSync,
        bound: Record<string, SQLInputValue>,
        maxRows: number,
        signal: AbortSignal | undefined,
    ): Partial {
        const rows: unknown[][] = [];
        let columns: ColumnInfo[] | undefined;
        let truncated = false;
        const iterator = prepared.iterate(bound);
        try {
            for (const row of iterator) {
                if (rows.length % ABORT_CHECK_EVERY === 0) {
                    this.throwIfAborted(signal);
                }
                columns ??= columnsOf(prepared, row);
                if (rows.length >= maxRows) {
                    truncated = true;
                    break;
                }
                rows.push(columns.map((column) => toCell(row[column.name])));
            }
        } finally {
            iterator.return?.();
        }
        columns ??= columnsOf(prepared, undefined);
        return { columns, rowCount: rows.length, rows, rowsAffected: [], truncated };
    }

    private throwIfAborted(signal: AbortSignal | undefined): void {
        if (signal?.aborted) {
            throw new AbortedError();
        }
    }
}
