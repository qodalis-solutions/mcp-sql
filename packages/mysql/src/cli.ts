#!/usr/bin/env node
import { PoolManager, runCli } from '@qodalis/mcp-sql-core';
import { ENV_FILE_VARIABLES, loadConfig } from './config.js';
import { mysqlDialect } from './dialect.js';
import { SERVER_NAME, SERVER_VERSION, WEBSITE_URL } from './server.js';
import { MysqlExecutor } from './sql/executor.js';
import { createMysqlPool } from './sql/mysql-pool.js';
import { ALL_TOOLS } from './tools/index.js';

const usage = `Configuration is read from the environment (MYSQL_* names, MARIADB_* aliases, or MYSQL_URL):
  MYSQL_HOST (required)            MYSQL_PORT (3306)
  MYSQL_USER (required)            MYSQL_PASSWORD (optional)
  MYSQL_DATABASE                   MYSQL_DATABASES (comma-separated allowlist)
  MYSQL_URL                        mysql://user:pass@host:port/db?ssl=require
  MYSQL_SSL (false)                false | require | verify
  MYSQL_READ_ONLY (true)           MYSQL_MAX_ROWS (1000)
  MYSQL_CONNECTION_TIMEOUT (8000 ms)  MYSQL_REQUEST_TIMEOUT (30000 ms)
  MYSQL_POOL_MAX (10)              MYSQL_QUERY_LOG (false)
  MYSQL_ENV_FILE (same as --env-file)
`;

void runCli({
    createRuntime: (config, log) => {
        const manager = new PoolManager({ createPool: createMysqlPool(config), log });
        return {
            closeAll: () => manager.closeAll(),
            executor: new MysqlExecutor(manager, {
                maxRows: config.maxRows,
                queryTimeoutMs: config.requestTimeoutMs,
            }),
            poolState: (database) => manager.describe(database),
        };
    },
    dialect: mysqlDialect,
    envFileVariables: ENV_FILE_VARIABLES,
    loadConfig,
    packageName: SERVER_NAME,
    tools: ALL_TOOLS,
    usage,
    version: SERVER_VERSION,
    websiteUrl: WEBSITE_URL,
});
