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
import { typeNameForOid } from './types.js';

export type {
    ColumnInfo,
    ExecutorDefaults,
    IQueryExecutor,
    QueryResult,
    RunOptions,
} from '@qodalis/mcp-sql-core';
export { AbortedError } from '@qodalis/mcp-sql-core';

export type PgField = { dataTypeID: number; name: string };

export type PgSimpleResult = {
    command?: string;
    fields?: PgField[];
    rowCount?: number | null;
    rows: Array<Record<string, unknown>>;
};

/** The slice of `pg-cursor` used here. */
export interface PgCursorLike {
    close(callback: (error?: Error) => void): void;
    read(
        count: number,
        callback: (
            error: Error | undefined,
            rows: Array<Record<string, unknown>>,
            result: { command?: string; fields?: PgField[]; rowCount?: number | null },
        ) => void,
    ): void;
}

/** The slice of a checked-out `pg` client used here. */
export interface PgClientLike {
    on(event: 'notice', listener: (notice: { message?: string }) => void): unknown;
    query(cursor: PgCursorLike): PgCursorLike;
    query(text: string): Promise<PgSimpleResult | PgSimpleResult[]>;
    release(destroy?: boolean): void;
}

/** A pool the executor can draw clients from; implemented by {@link PgPool}. */
export interface PgPoolLike extends PoolLike {
    acquire(): Promise<PgClientLike>;
    createCursor(sql: string, values: unknown[]): PgCursorLike;
}

const BATCH_SIZE = 200;

/** How long a portal close may take before the client is treated as dead. */
const DEFAULT_CLOSE_TIMEOUT_MS = 5000;

export type PgExecutorDefaults = ExecutorDefaults & {
    /** Milliseconds to wait for a portal close before destroying the client. */
    closeTimeoutMs?: number;
};

/**
 * Closes the cursor's portal so the client can go back to the pool. Resolves
 * `false` when the close does not complete in time, which happens when the
 * socket died underneath the cursor (pg-cursor waits for a readyForQuery that
 * never arrives); the caller then destroys the client instead of reusing it.
 */
const closePortal = (cursor: PgCursorLike, timeoutMs: number): Promise<boolean> =>
    new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref();
        cursor.close(() => {
            clearTimeout(timer);
            resolve(true);
        });
    });

const toColumns = (fields: PgField[] | undefined): ColumnInfo[] =>
    (fields ?? []).map((field) => ({
        name: field.name,
        nullable: true,
        type: typeNameForOid(field.dataTypeID),
    }));

const toRowArray = (row: Record<string, unknown>, columns: ColumnInfo[]): unknown[] =>
    columns.map((column) => row[column.name]);

/** True when the scrubbed SQL holds more than one statement. */
const isMultiStatement = (sql: string): boolean => {
    let depth = 0;
    let inString: string | undefined;
    let dollarTag: string | undefined;
    let seenStatementEnd = false;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i] ?? '';
        if (dollarTag) {
            if (sql.startsWith(dollarTag, i)) {
                i += dollarTag.length - 1;
                dollarTag = undefined;
            }
            continue;
        }
        if (inString) {
            if (ch === inString) {
                if (sql[i + 1] === inString) {
                    i++;
                } else {
                    inString = undefined;
                }
            }
            continue;
        }
        if (ch === "'" || ch === '"') {
            inString = ch;
            continue;
        }
        if (ch === '$') {
            const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
            if (tag) {
                dollarTag = tag[0];
                i += tag[0].length - 1;
                continue;
            }
        }
        if (sql.startsWith('--', i)) {
            const end = sql.indexOf('\n', i);
            i = end === -1 ? sql.length : end;
            continue;
        }
        if (sql.startsWith('/*', i)) {
            const end = sql.indexOf('*/', i + 2);
            i = end === -1 ? sql.length : end + 1;
            continue;
        }
        if (ch === '(') {
            depth++;
        } else if (ch === ')') {
            depth = Math.max(0, depth - 1);
        } else if (ch === ';' && depth === 0) {
            seenStatementEnd = true;
        } else if (seenStatementEnd && /\S/.test(ch)) {
            return true;
        }
    }
    return false;
};

/**
 * Executes SQL through the pool manager. Single statements go through a server
 * side cursor (streamed in batches, hard row cap, positional parameters);
 * multi-statement batches use the simple protocol, which PostgreSQL requires
 * for them and which cannot carry parameters.
 */
export class PgExecutor implements IQueryExecutor {
    constructor(
        private readonly manager: PoolManager<PgPoolLike>,
        private readonly defaults: PgExecutorDefaults,
    ) {}

    run(options: RunOptions): Promise<QueryResult> {
        return this.manager.withRetry(options.database, (pool) => this.runOnPool(pool, options));
    }

    private async runOnPool(pool: PgPoolLike, options: RunOptions): Promise<QueryResult> {
        const maxRows = options.maxRows ?? this.defaults.maxRows;
        const hasParams = Boolean(options.params && Object.keys(options.params).length > 0);
        const multi = isMultiStatement(options.sql);
        if (multi && hasParams) {
            throw new Error(
                'Parameters can only be used with a single statement; split the batch or inline the values.',
            );
        }
        const started = Date.now();
        const client = await pool.acquire();
        const messages: string[] = [];
        client.on('notice', (notice) => {
            if (notice?.message) {
                messages.push(notice.message);
            }
        });
        let destroy = false;
        try {
            const partial = multi
                ? await this.runSimple(client, options.sql, maxRows)
                : await this.runCursor(pool, client, options, maxRows, (dead) => {
                      destroy = dead;
                  });
            return { ...partial, durationMs: Date.now() - started, messages };
        } catch (error) {
            destroy = destroy || error instanceof AbortedError || isConnectionError(error);
            throw error;
        } finally {
            client.release(destroy);
        }
    }

    private async runSimple(
        client: PgClientLike,
        sql: string,
        maxRows: number,
    ): Promise<Omit<QueryResult, 'durationMs' | 'messages'>> {
        const raw = await client.query(sql);
        const results = Array.isArray(raw) ? raw : [raw];
        const rowsAffected = results
            .filter((r) => (r.fields ?? []).length === 0 && typeof r.rowCount === 'number')
            .map((r) => r.rowCount as number);
        const last = [...results].reverse().find((r) => (r.fields ?? []).length > 0);
        const columns = toColumns(last?.fields);
        const allRows = (last?.rows ?? []).map((row) => toRowArray(row, columns));
        const truncated = allRows.length > maxRows;
        const rows = truncated ? allRows.slice(0, maxRows) : allRows;
        return { columns, rowCount: rows.length, rows, rowsAffected, truncated };
    }

    private runCursor(
        pool: PgPoolLike,
        client: PgClientLike,
        options: RunOptions,
        maxRows: number,
        onClientDead: (dead: boolean) => void,
    ): Promise<Omit<QueryResult, 'durationMs' | 'messages'>> {
        const { sql, values } = toPositionalParams(options.sql, options.params);
        const cursor = client.query(pool.createCursor(sql, values));
        return new Promise((resolve, reject) => {
            const rows: unknown[][] = [];
            let columns: ColumnInfo[] = [];
            let rowsAffected: number[] = [];
            let settled = false;
            const result = () => ({ columns, rowCount: rows.length, rows, rowsAffected });

            const settle = () => {
                if (settled) {
                    return false;
                }
                settled = true;
                options.signal?.removeEventListener('abort', onAbort);
                return true;
            };
            // Errors and aborts settle immediately: the connection may be dead, and
            // waiting for the portal close would hang forever. The client is
            // destroyed rather than reused in those cases.
            const fail = (error: Error) => {
                if (settle()) {
                    reject(error);
                }
            };
            const onAbort = () => fail(new AbortedError());
            if (options.signal?.aborted) {
                onAbort();
                return;
            }
            options.signal?.addEventListener('abort', onAbort, { once: true });

            // Normal completion closes the portal first so the client goes back to
            // the pool clean; a close that never completes marks the client dead.
            const complete = (truncated: boolean) => {
                if (!settle()) {
                    return;
                }
                void closePortal(
                    cursor,
                    this.defaults.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS,
                ).then((clean) => {
                    onClientDead(!clean);
                    resolve({ ...result(), truncated });
                });
            };

            const readBatch = () => {
                const want = Math.min(BATCH_SIZE, maxRows - rows.length + 1);
                cursor.read(want, (error, batch, meta) => {
                    if (settled) {
                        return;
                    }
                    if (error) {
                        fail(error);
                        return;
                    }
                    if (columns.length === 0 && meta?.fields) {
                        columns = toColumns(meta.fields);
                    }
                    const isCommand =
                        columns.length === 0 &&
                        typeof meta?.rowCount === 'number' &&
                        batch.length === 0;
                    if (isCommand) {
                        rowsAffected = [meta.rowCount as number];
                    }
                    for (const row of batch) {
                        if (rows.length < maxRows) {
                            rows.push(toRowArray(row, columns));
                        }
                    }
                    const exhausted = batch.length < want;
                    if (exhausted) {
                        complete(false);
                        return;
                    }
                    if (rows.length >= maxRows) {
                        complete(true);
                        return;
                    }
                    readBatch();
                });
            };
            readBatch();
        });
    }
}
