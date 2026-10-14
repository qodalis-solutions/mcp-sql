import type { PoolLike, PoolManager } from './pool-manager.js';

/** Column descriptor returned with every result set. */
export type ColumnInfo = {
    name: string;
    nullable: boolean;
    type: string;
};

export type QueryResult = {
    columns: ColumnInfo[];
    durationMs: number;
    messages: string[];
    rowCount: number;
    rows: unknown[][];
    rowsAffected: number[];
    truncated: boolean;
};

export type RunOptions = {
    database?: string | undefined;
    maxRows?: number | undefined;
    params?: Record<string, unknown> | undefined;
    signal?: AbortSignal | undefined;
    sql: string;
};

export interface IQueryExecutor {
    run(options: RunOptions): Promise<QueryResult>;
}

/** The streaming surface of `mssql.Request` used here. */
export interface RequestLike {
    stream: boolean;
    cancel(): void;
    input(name: string, value: unknown): unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, listener: (...args: any[]) => void): unknown;
    query(sql: string): unknown;
}

export interface QueryPoolLike extends PoolLike {
    request(): RequestLike;
}

export type ExecutorDefaults = {
    maxRows: number;
};

type RawColumn = {
    index?: number;
    name?: string;
    nullable?: boolean;
    type?: unknown;
    length?: number;
};

const typeName = (column: RawColumn): string => {
    const type = column.type as { declaration?: string } | string | undefined;
    if (type && typeof type === 'object' && typeof type.declaration === 'string') {
        return type.declaration;
    }
    if (typeof type === 'function') {
        const declaration = (type as { declaration?: string }).declaration;
        return declaration ?? 'unknown';
    }
    return typeof type === 'string' ? type : 'unknown';
};

/** mssql emits recordset metadata keyed by column name (or as an array in arrayRowMode). */
const toColumns = (meta: unknown): ColumnInfo[] => {
    const entries = Array.isArray(meta)
        ? (meta as RawColumn[])
        : Object.values((meta ?? {}) as Record<string, RawColumn>).sort(
              (a, b) => (a.index ?? 0) - (b.index ?? 0),
          );
    return entries.map((column) => ({
        name: column.name ?? '',
        nullable: column.nullable ?? true,
        type: typeName(column),
    }));
};

const toRowArray = (row: unknown, columns: ColumnInfo[]): unknown[] => {
    if (Array.isArray(row)) {
        return row;
    }
    const record = row as Record<string, unknown>;
    return columns.map((column) => record[column.name]);
};

const isCancel = (error: unknown): boolean =>
    error instanceof Error && (error as { code?: string }).code === 'ECANCEL';

export class AbortedError extends Error {
    constructor() {
        super('Query aborted by the client.');
        this.name = 'AbortedError';
    }
}

/**
 * Executes SQL through the pool manager with streaming, a hard row cap,
 * parameter binding, abort support and one automatic retry on connection loss.
 */
export class SqlExecutor implements IQueryExecutor {
    constructor(
        private readonly manager: PoolManager<QueryPoolLike>,
        private readonly defaults: ExecutorDefaults,
    ) {}

    run(options: RunOptions): Promise<QueryResult> {
        return this.manager.withRetry(options.database, (pool) => this.runOnPool(pool, options));
    }

    private runOnPool(pool: QueryPoolLike, options: RunOptions): Promise<QueryResult> {
        const maxRows = options.maxRows ?? this.defaults.maxRows;
        const started = Date.now();
        const request = pool.request();
        request.stream = true;
        for (const [name, value] of Object.entries(options.params ?? {})) {
            request.input(name, value);
        }

        return new Promise<QueryResult>((resolve, reject) => {
            let columns: ColumnInfo[] = [];
            const rows: unknown[][] = [];
            const messages: string[] = [];
            let truncated = false;
            let aborted = false;
            let failure: unknown;

            const onAbort = () => {
                aborted = true;
                request.cancel();
            };
            if (options.signal?.aborted) {
                onAbort();
            }
            options.signal?.addEventListener('abort', onAbort, { once: true });

            request.on('recordset', (meta: unknown) => {
                columns = toColumns(meta);
            });
            request.on('row', (row: unknown) => {
                if (truncated || aborted) {
                    return;
                }
                if (rows.length >= maxRows) {
                    truncated = true;
                    request.cancel();
                    return;
                }
                rows.push(toRowArray(row, columns));
            });
            request.on('info', (info: { message?: string }) => {
                if (info?.message) {
                    messages.push(info.message);
                }
            });
            request.on('error', (error: unknown) => {
                const expectedCancel = isCancel(error) && (truncated || aborted);
                if (!expectedCancel) {
                    failure = error;
                }
            });
            request.on('done', (summary: { rowsAffected?: number[] }) => {
                options.signal?.removeEventListener('abort', onAbort);
                if (aborted) {
                    reject(new AbortedError());
                    return;
                }
                if (failure !== undefined) {
                    reject(failure);
                    return;
                }
                resolve({
                    columns,
                    durationMs: Date.now() - started,
                    messages,
                    rowCount: rows.length,
                    rows,
                    rowsAffected: summary?.rowsAffected ?? [],
                    truncated,
                });
            });

            request.query(options.sql);
        });
    }
}
