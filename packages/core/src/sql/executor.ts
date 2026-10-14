/**
 * Executor contract shared by every dialect. Each dialect package implements
 * {@link IQueryExecutor} on top of its driver; everything above it (tools,
 * server, CLI) only depends on these types.
 */
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

export type ExecutorDefaults = {
    maxRows: number;
};

export class AbortedError extends Error {
    constructor() {
        super('Query aborted by the client.');
        this.name = 'AbortedError';
    }
}
