import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PoolManager } from '@qodalis/mcp-sql-core';
import { loadConfig, type Config } from '../../src/config.js';
import { SqliteExecutor } from '../../src/sql/executor.js';
import { createSqliteDatabase, type SqliteDatabase } from '../../src/sql/sqlite-db.js';

export type TempDb = {
    config: Config;
    dir: string;
    executor: SqliteExecutor;
    file: string;
    manager: PoolManager<SqliteDatabase>;
    cleanup: () => Promise<void>;
};

/** Writes a fresh SQLite file with the given DDL/DML and wires the runtime to it. */
export const makeTempDb = (
    setupSql: string,
    env: Record<string, string> = {},
    name = 'app.db',
): TempDb => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-sqlite-'));
    const file = path.join(dir, name);
    writeFile(file, setupSql);
    const config = loadConfig({ SQLITE_DATABASE: file, ...env });
    const manager = new PoolManager<SqliteDatabase>({ createPool: createSqliteDatabase(config) });
    const executor = new SqliteExecutor(manager, { maxRows: config.maxRows });
    return {
        config,
        dir,
        executor,
        file,
        manager,
        cleanup: async () => {
            await manager.closeAll();
            rmSync(dir, { recursive: true, force: true });
        },
    };
};

export const writeFile = (file: string, setupSql: string): void => {
    const db = new DatabaseSync(file);
    db.exec(setupSql);
    db.close();
};

export const SAMPLE_SQL = `
create table t (id integer primary key, name text not null, big integer, b blob, r real, flag boolean);
insert into t values (1, 'a', 9007199254740993, x'00ff', 1.5, 1);
insert into t values (2, 'b', 42, null, null, 0);
insert into t values (3, 'c', -7, x'', 0.25, null);
`;
