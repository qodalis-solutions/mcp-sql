#!/usr/bin/env node
import { PoolManager, runCli } from '@qodalis/mcp-sql-core';
import { ENV_FILE_VARIABLES, loadConfig } from './config.js';
import { oracleDialect } from './dialect.js';
import { SERVER_NAME, SERVER_VERSION, WEBSITE_URL } from './server.js';
import { OracleExecutor } from './sql/executor.js';
import { createOraclePool } from './sql/oracle-pool.js';
import { ALL_TOOLS } from './tools/index.js';

const usage = `Configuration is read from the environment (ORACLE_* names, or ORACLE_CONNECT_STRING / ORACLE_URL):
  ORACLE_HOST (required*)          ORACLE_PORT (1521)
  ORACLE_SERVICE (required*)       ORACLE_CONNECT_STRING (EZConnect or TNS descriptor; replaces host/port/service)
  ORACLE_URL                       oracle://user:pass@host:port/service
  ORACLE_USER (required)           ORACLE_PASSWORD (required)
  ORACLE_DATABASE (schema, default = user)   ORACLE_DATABASES (comma-separated schema allowlist)
  ORACLE_WALLET_LOCATION           ORACLE_WALLET_PASSWORD (mTLS / Autonomous Database)
  ORACLE_READ_ONLY (true)          ORACLE_MAX_ROWS (1000)
  ORACLE_CONNECTION_TIMEOUT (8000 ms)  ORACLE_REQUEST_TIMEOUT (30000 ms)
  ORACLE_POOL_MAX (10)             ORACLE_QUERY_LOG (false)
  ORACLE_ENV_FILE (same as --env-file)
  An Oracle session lives in one database: "database" selects the SCHEMA to look in.
`;

void runCli({
    createRuntime: (config, log) => {
        const manager = new PoolManager({ createPool: createOraclePool(config), log });
        return {
            closeAll: () => manager.closeAll(),
            executor: new OracleExecutor(manager, {
                maxRows: config.maxRows,
                readOnly: config.readOnly,
            }),
            poolState: (database) => manager.describe(database),
        };
    },
    dialect: oracleDialect,
    envFileVariables: ENV_FILE_VARIABLES,
    loadConfig,
    packageName: SERVER_NAME,
    tools: ALL_TOOLS,
    usage,
    version: SERVER_VERSION,
    websiteUrl: WEBSITE_URL,
});
