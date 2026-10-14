#!/usr/bin/env node
import { PoolManager, runCli } from '@qodalis/mcp-sql-core';
import { ENV_FILE_VARIABLES, loadConfig } from './config.js';
import { sqlserverDialect } from './dialect.js';
import { SERVER_NAME, SERVER_VERSION, WEBSITE_URL } from './server.js';
import { SqlExecutor } from './sql/executor.js';
import { createMssqlPool } from './sql/mssql-pool.js';
import { ALL_TOOLS } from './tools/index.js';

const usage = `Configuration is read from the environment (SQLSERVER_* or MSSQL_* names):
  SQLSERVER_HOST (required)        SQLSERVER_PORT (1433)
  SQLSERVER_USER (required)        SQLSERVER_PASSWORD (required)
  SQLSERVER_DATABASE               SQLSERVER_DATABASES (comma-separated allowlist)
  SQLSERVER_DOMAIN (NTLM)          SQLSERVER_ENCRYPT (true)
  SQLSERVER_TRUST_CERT (false)     SQLSERVER_READ_ONLY (true)
  SQLSERVER_MAX_ROWS (1000)        SQLSERVER_CONNECTION_TIMEOUT (8000 ms)
  SQLSERVER_REQUEST_TIMEOUT (30000 ms)  SQLSERVER_POOL_MAX (10)
  SQLSERVER_USE_UTC (true)         SQLSERVER_QUERY_LOG (false)
  SQLSERVER_ENV_FILE               path to a .env file (same as --env-file)
`;

void runCli({
    createRuntime: (config, log) => {
        const manager = new PoolManager({ createPool: createMssqlPool(config), log });
        return {
            closeAll: () => manager.closeAll(),
            executor: new SqlExecutor(manager, { maxRows: config.maxRows }),
            poolState: (database) => manager.describe(database),
        };
    },
    dialect: sqlserverDialect,
    envFileVariables: ENV_FILE_VARIABLES,
    loadConfig,
    packageName: SERVER_NAME,
    tools: ALL_TOOLS,
    usage,
    version: SERVER_VERSION,
    websiteUrl: WEBSITE_URL,
});
