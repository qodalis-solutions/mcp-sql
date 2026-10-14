import { EventEmitter } from 'node:events';
import type { PoolLike } from '@qodalis/mcp-sql-core';
import type { RequestLike } from '../../src/sql/executor.js';

export type ColumnMeta = { name: string; type: string; nullable?: boolean };

export type Script = {
    columns?: ColumnMeta[];
    rows?: unknown[];
    rowsAffected?: number[];
    messages?: string[];
    error?: Error;
    /** Emit rows with a small delay so abort/cancel can interleave. */
    slow?: boolean;
};

/** Emits events the way mssql's streaming Request does. */
export class FakeRequest extends EventEmitter implements RequestLike {
    stream = false;
    cancelled = false;
    readonly inputs: Array<{ name: string; value: unknown }> = [];
    lastSql = '';

    constructor(private readonly script: Script) {
        super();
    }

    input(name: string, value: unknown): this {
        this.inputs.push({ name, value });
        return this;
    }

    cancel(): void {
        this.cancelled = true;
    }

    query(sql: string): void {
        this.lastSql = sql;
        void this.play();
    }

    private async play(): Promise<void> {
        await Promise.resolve();
        if (this.script.error) {
            this.emit('error', this.script.error);
            this.emit('done', { rowsAffected: [] });
            return;
        }
        for (const message of this.script.messages ?? []) {
            this.emit('info', { message });
        }
        const columns = this.script.columns ?? [];
        if (columns.length > 0) {
            const meta: Record<string, unknown> = {};
            columns.forEach((column, index) => {
                meta[column.name] = {
                    index,
                    name: column.name,
                    type: { declaration: column.type },
                    nullable: column.nullable ?? true,
                };
            });
            this.emit('recordset', meta);
        }
        for (const row of this.script.rows ?? []) {
            if (this.cancelled) {
                break;
            }
            if (this.script.slow) {
                await new Promise((resolve) => setTimeout(resolve, 2));
            }
            if (this.cancelled) {
                break;
            }
            this.emit('row', row);
        }
        if (this.cancelled) {
            this.emit('error', Object.assign(new Error('Canceled.'), { code: 'ECANCEL' }));
        }
        this.emit('done', { rowsAffected: this.script.rowsAffected ?? [] });
    }
}

export class FakeQueryPool extends EventEmitter implements PoolLike {
    connected = false;
    connecting = false;
    readonly requests: FakeRequest[] = [];
    scripts: Script[] = [];

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

    request(): FakeRequest {
        const script = this.scripts.shift() ?? {};
        const request = new FakeRequest(script);
        this.requests.push(request);
        return request;
    }
}
