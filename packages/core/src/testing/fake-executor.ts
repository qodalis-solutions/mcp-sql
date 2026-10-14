import type { Dialect } from '../dialect.js';
import type { IQueryExecutor, QueryResult, RunOptions } from '../sql/executor.js';
import type { ToolContext } from '../tools/context.js';

export const emptyResult = (): QueryResult => ({
    columns: [],
    durationMs: 1,
    messages: [],
    rowCount: 0,
    rows: [],
    rowsAffected: [],
    truncated: false,
});

export const tableResult = (columns: string[], rows: unknown[][]): QueryResult => ({
    columns: columns.map((name) => ({ name, nullable: true, type: 'text' })),
    durationMs: 1,
    messages: [],
    rowCount: rows.length,
    rows,
    rowsAffected: [rows.length],
    truncated: false,
});

/** Records every call and answers from a queue (or a resolver) of results. */
export class FakeExecutor implements IQueryExecutor {
    readonly calls: RunOptions[] = [];
    queue: QueryResult[] = [];
    resolver: ((options: RunOptions) => QueryResult | Promise<QueryResult>) | undefined;
    failWith: unknown;

    async run(options: RunOptions): Promise<QueryResult> {
        this.calls.push(options);
        if (this.failWith !== undefined) {
            throw this.failWith;
        }
        if (this.resolver) {
            return this.resolver(options);
        }
        return this.queue.shift() ?? emptyResult();
    }

    get lastSql(): string {
        return this.calls.at(-1)?.sql ?? '';
    }

    get lastParams(): Record<string, unknown> {
        return this.calls.at(-1)?.params ?? {};
    }
}

export type FakeContext = ToolContext & { executor: FakeExecutor };

/** A tool context backed by a FakeExecutor for the given dialect. */
export const makeContext = (
    dialect: Dialect,
    overrides: Partial<ToolContext> = {},
): FakeContext => {
    const executor = new FakeExecutor();
    return {
        config: {
            allowedDatabases: ['Sales', 'Archive'],
            database: 'Sales',
            maxRows: 1000,
            password: 'p@ss',
            readOnly: true,
            server: 'db.example.com',
            user: 'reader',
        },
        dialect,
        executor,
        poolState: () => ({ connected: true, connecting: false }),
        ...overrides,
    } as FakeContext;
};

/** First text block of a tool result. */
export const resultText = (result: { content: unknown[] }): string =>
    (result.content[0] as { text: string } | undefined)?.text ?? '';
