#!/usr/bin/env node
import { PoolManager, runCli } from '@qodalis/mcp-sql-core';
import { ENV_FILE_VARIABLES, loadConfig } from './config.js';
import { sqliteDialect } from './dialect.js';
import { SERVER_NAME, SERVER_VERSION, WEBSITE_URL } from './server.js';
import { SqliteExecutor } from './sql/executor.js';
import { createSqliteDatabase } from './sql/sqlite-db.js';
import { ALL_TOOLS } from './tools/index.js';

const usage = `Configuration is read from the environment (SQLITE_* names):
  SQLITE_DATABASE (required)       path to the file, or :memory:
  SQLITE_DATABASES                 comma-separated allowlist of further files; each is addressed
                                   by its basename without extension (/data/app.db -> "app")
  SQLITE_READ_ONLY (true)          open the file read-only and reject persistent writes
  SQLITE_CREATE_IF_MISSING (false) create a missing file (needs SQLITE_READ_ONLY=false)
  SQLITE_MAX_ROWS (1000)           SQLITE_REQUEST_TIMEOUT (30000 ms busy timeout)
  SQLITE_QUERY_LOG (false)         SQLITE_ENV_FILE (same as --env-file)
`;

void runCli({
    createRuntime: (config, log) => {
        const manager = new PoolManager({ createPool: createSqliteDatabase(config), log });
        return {
            closeAll: () => manager.closeAll(),
            executor: new SqliteExecutor(manager, { maxRows: config.maxRows }),
            poolState: (database) => manager.describe(database),
        };
    },
    dialect: sqliteDialect,
    envFileVariables: ENV_FILE_VARIABLES,
    loadConfig,
    packageName: SERVER_NAME,
    tools: ALL_TOOLS,
    usage,
    version: SERVER_VERSION,
    websiteUrl: WEBSITE_URL,
});
