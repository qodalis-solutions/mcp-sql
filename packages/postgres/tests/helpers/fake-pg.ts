import { EventEmitter } from 'node:events';
import type { PoolLike } from '@qodalis/mcp-sql-core';
import type {
    PgClientLike,
    PgCursorLike,
    PgPoolLike,
    PgSimpleResult,
} from '../../src/sql/executor.js';

export type FieldMeta = { name: string; dataTypeID: number };

export type Script = {
    fields?: FieldMeta[];
    rows?: unknown[][];
    rowCount?: number | null;
    command?: string;
    notices?: string[];
    error?: Error;
    /** Simulates a dead socket: `close()` never calls back (pg-cursor waits for readyForQuery). */
    closeHangs?: boolean;
    /** Delay per cursor read, to let abort signals fire mid-stream. */
    readDelayMs?: number;
    /** Results for a multi-statement simple query. */
    simple?: PgSimpleResult[];
};

export class FakeCursor implements PgCursorLike {
    closed = false;
    reads: number[] = [];
    private offset = 0;

    constructor(readonly script: Script) {}

    read(
        count: number,
        callback: (
            error: Error | undefined,
            rows: Array<Record<string, unknown>>,
            result: { fields?: FieldMeta[]; rowCount?: number | null; command?: string },
        ) => void,
    ): void {
        this.reads.push(count);
        const deliver = () => {
            if (this.script.error) {
                callback(this.script.error, [], {});
                return;
            }
            const all = this.script.rows ?? [];
            const batch = all.slice(this.offset, this.offset + count);
            this.offset += batch.length;
            const meta = {
                fields: this.script.fields ?? [],
                rowCount: this.script.rowCount ?? all.length,
                command: this.script.command ?? 'SELECT',
            };
            callback(
                undefined,
                batch.map((row) =>
                    Object.fromEntries((this.script.fields ?? []).map((f, i) => [f.name, row[i]])),
                ),
                meta,
            );
        };
        if (this.script.readDelayMs) {
            setTimeout(deliver, this.script.readDelayMs);
        } else {
            setImmediate(deliver);
        }
    }

    close(callback: (error?: Error) => void): void {
        this.closed = true;
        if (this.script.closeHangs) {
            return;
        }
        setImmediate(() => callback());
    }
}

export class FakeClient extends EventEmitter implements PgClientLike {
    released: boolean | undefined;
    cursors: FakeCursor[] = [];
    simpleQueries: string[] = [];

    constructor(private readonly scripts: Script[]) {
        super();
    }

    query(cursor: PgCursorLike): PgCursorLike;
    query(text: string): Promise<PgSimpleResult | PgSimpleResult[]>;
    query(input: PgCursorLike | string): PgCursorLike | Promise<PgSimpleResult | PgSimpleResult[]> {
        // A cursor already took its script in createCursor; only simple queries consume one here.
        const script = input instanceof FakeCursor ? input.script : (this.scripts.shift() ?? {});
        for (const notice of script.notices ?? []) {
            setImmediate(() => this.emit('notice', { message: notice }));
        }
        if (typeof input === 'string') {
            this.simpleQueries.push(input);
            if (script.error) {
                return Promise.reject(script.error);
            }
            return Promise.resolve(script.simple ?? []);
        }
        return input;
    }

    release(destroy?: boolean): void {
        this.released = destroy ?? false;
    }
}

export class FakePgPool extends EventEmitter implements PgPoolLike, PoolLike {
    connected = false;
    connecting = false;
    scripts: Script[] = [];
    readonly clients: FakeClient[] = [];
    readonly createdCursors: FakeCursor[] = [];
    lastCursorSql = '';
    lastCursorValues: unknown[] = [];

    constructor(public readonly database: string | undefined) {
        super();
    }

    async connect(): Promise<this> {
        this.connected = true;
        return this;
    }

    async close(): Promise<void> {
        this.connected = false;
    }

    async acquire(): Promise<FakeClient> {
        const client = new FakeClient(this.scripts);
        this.clients.push(client);
        return client;
    }

    createCursor(sql: string, values: unknown[]): FakeCursor {
        this.lastCursorSql = sql;
        this.lastCursorValues = values;
        const script = this.scripts.shift() ?? {};
        const cursor = new FakeCursor(script);
        this.createdCursors.push(cursor);
        return cursor;
    }
}
