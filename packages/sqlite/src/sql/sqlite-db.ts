import { EventEmitter } from 'node:events';
import { existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ConfigError, type PoolLike } from '@qodalis/mcp-sql-core';
import { MEMORY, type Config } from '../config.js';

/**
 * One open SQLite file, shaped like a connection pool so the core PoolManager
 * can manage it. `connected` goes false when the handle was closed, or when
 * the file on disk is no longer the inode that was opened (deleted, replaced,
 * restored from a backup): a stale handle would otherwise keep serving the
 * old contents forever, so the manager reopens it on the next call.
 */
export class SqliteDatabase extends EventEmitter implements PoolLike {
    connecting = false;
    private db: DatabaseSync | undefined;
    private inode: bigint | undefined;

    constructor(
        readonly file: string,
        private readonly config: Config,
    ) {
        super();
    }

    get connected(): boolean {
        if (!this.db?.isOpen) {
            return false;
        }
        if (this.file === MEMORY) {
            return true;
        }
        return this.currentInode() === this.inode;
    }

    /** The open handle; throws when not connected. */
    get handle(): DatabaseSync {
        if (!this.db?.isOpen) {
            throw new Error(`SQLite file ${this.file} is not open.`);
        }
        return this.db;
    }

    async connect(): Promise<this> {
        this.connecting = true;
        try {
            const isMemory = this.file === MEMORY;
            const exists = isMemory || existsSync(this.file);
            if (!exists && !this.config.createIfMissing) {
                throw new ConfigError(
                    `SQLite file ${this.file} does not exist. Check SQLITE_DATABASE, or set SQLITE_CREATE_IF_MISSING=true (with SQLITE_READ_ONLY=false) to create it.`,
                );
            }
            // An empty read-only memory database would be useless; the statement guard still applies.
            const readOnly = this.config.readOnly && !isMemory && exists;
            this.db = new DatabaseSync(this.file, {
                readOnly,
                timeout: this.config.requestTimeoutMs,
            });
            this.inode = isMemory ? undefined : this.currentInode();
            return this;
        } finally {
            this.connecting = false;
        }
    }

    async close(): Promise<void> {
        const db = this.db;
        this.db = undefined;
        this.inode = undefined;
        if (db?.isOpen) {
            db.close();
        }
    }

    /** Drops the handle without closing semantics mattering, after an unrecoverable file error. */
    async discard(): Promise<void> {
        await this.close();
    }

    private currentInode(): bigint | undefined {
        try {
            return statSync(this.file, { bigint: true }).ino;
        } catch {
            return undefined;
        }
    }
}

/** Factory for the PoolManager: maps a database key to its file. */
export const createSqliteDatabase =
    (config: Config) =>
    (database: string | undefined): SqliteDatabase => {
        const key = database ?? config.database;
        const file = key === undefined ? undefined : config.files[key];
        if (file === undefined) {
            throw new ConfigError(
                `Unknown SQLite database "${key ?? ''}". Configured: ${Object.keys(config.files).join(', ')}.`,
            );
        }
        return new SqliteDatabase(file, config);
    };
