import { EventEmitter } from 'node:events';
import type { PoolLike } from '@qodalis/mcp-sql-core';
import type {
    MysqlConnectionLike,
    MysqlField,
    MysqlPoolLike,
    MysqlQueryLike,
    MysqlQueryOptions,
} from '../../src/sql/executor.js';

export type FieldMeta = MysqlField;

export type ResultSetScript = { fields: FieldMeta[]; rows: unknown[][] } | { affectedRows: number };

export type Script = {
    /** Result sets in protocol order; an OK packet is `{ affectedRows }`. */
    results?: ResultSetScript[];
    /** Emitted instead of `end` after whatever rows were sent. */
    error?: Error;
    /** Delay before each row, to let abort signals fire mid-stream. */
    rowDelayMs?: number;
};

export class FakeQuery extends EventEmitter implements MysqlQueryLike {
    constructor(
        readonly script: Script,
        private readonly connection: FakeConnection,
    ) {
        super();
    }

    start(): void {
        const steps: Array<() => void> = [];
        (this.script.results ?? []).forEach((set, index) => {
            if ('affectedRows' in set) {
                steps.push(() =>
                    this.emit('result', { affectedRows: set.affectedRows, insertId: 0 }, index),
                );
                return;
            }
            steps.push(() => this.emit('fields', set.fields, index));
            for (const row of set.rows) {
                steps.push(() => this.emit('result', row, index));
            }
        });
        steps.push(() =>
            this.script.error ? this.emit('error', this.script.error) : this.emit('end'),
        );
        const run = (i: number) => {
            if (this.connection.destroyed || i >= steps.length) {
                return;
            }
            const step = steps[i]!;
            const next = () => {
                step();
                run(i + 1);
            };
            if (this.script.rowDelayMs) {
                setTimeout(next, this.script.rowDelayMs);
            } else {
                setImmediate(next);
            }
        };
        run(0);
    }
}

export class FakeConnection implements MysqlConnectionLike {
    released: boolean | undefined;
    destroyed = false;
    queries: MysqlQueryOptions[] = [];
    readonly threadId = 42;

    constructor(private readonly scripts: Script[]) {}

    query(options: MysqlQueryOptions): MysqlQueryLike {
        this.queries.push(options);
        const query = new FakeQuery(this.scripts.shift() ?? {}, this);
        query.start();
        return query;
    }

    release(destroy: boolean): void {
        this.released = destroy;
        this.destroyed = destroy;
    }
}

export class FakeMysqlPool extends EventEmitter implements MysqlPoolLike, PoolLike {
    connected = false;
    connecting = false;
    scripts: Script[] = [];
    readonly connections: FakeConnection[] = [];

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

    async acquire(): Promise<FakeConnection> {
        const connection = new FakeConnection(this.scripts);
        this.connections.push(connection);
        return connection;
    }
}
