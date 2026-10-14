import { EventEmitter } from 'node:events';
import type { Metadata } from 'oracledb';
import type {
    OracleConnectionLike,
    OracleExecuteResult,
    OraclePoolLike,
    OracleResultSetLike,
} from '../../src/sql/executor.js';

export type Script = {
    /** Result set metadata; presence means the statement returns rows. */
    metaData?: Metadata[];
    rows?: unknown[][];
    rowsAffected?: number;
    error?: Error;
    /** Delay per getRows call, to let abort signals fire mid-stream. */
    readDelayMs?: number;
};

export class FakeResultSet implements OracleResultSetLike {
    closed = false;
    reads: number[] = [];
    private offset = 0;

    constructor(
        private readonly script: Script,
        public readonly metaData: Metadata[],
    ) {}

    async getRows(numRows: number): Promise<unknown[][]> {
        this.reads.push(numRows);
        if (this.script.readDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, this.script.readDelayMs));
        }
        const all = this.script.rows ?? [];
        const batch = all.slice(this.offset, this.offset + numRows);
        this.offset += batch.length;
        return batch;
    }

    async close(): Promise<void> {
        this.closed = true;
    }
}

export class FakeConnection implements OracleConnectionLike {
    callTimeout = 0;
    closedWith: { drop?: boolean } | undefined | 'open' = 'open';
    executed: Array<{ sql: string; binds: Record<string, unknown>; autoCommit: boolean }> = [];
    resultSets: FakeResultSet[] = [];
    rollbacks = 0;

    constructor(private readonly scripts: Script[]) {}

    async execute(
        sql: string,
        binds: Record<string, unknown>,
        options: { autoCommit: boolean },
    ): Promise<OracleExecuteResult> {
        this.executed.push({ sql, binds, autoCommit: options.autoCommit });
        const script = this.scripts.shift() ?? {};
        if (script.error) {
            throw script.error;
        }
        if (script.metaData) {
            const resultSet = new FakeResultSet(script, script.metaData);
            this.resultSets.push(resultSet);
            return { metaData: script.metaData, resultSet };
        }
        return { rowsAffected: script.rowsAffected ?? 0 };
    }

    async rollback(): Promise<void> {
        this.rollbacks++;
    }

    async close(options?: { drop?: boolean }): Promise<void> {
        this.closedWith = options;
    }
}

export class FakeOraclePool extends EventEmitter implements OraclePoolLike {
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
