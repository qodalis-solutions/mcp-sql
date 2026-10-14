#!/usr/bin/env node
import { PoolManager, runCli } from '@qodalis/mcp-sql-core';
import { ENV_FILE_VARIABLES, loadConfig } from './config.js';
import { postgresDialect } from './dialect.js';
import { SERVER_NAME, SERVER_VERSION, WEBSITE_URL } from './server.js';
import { PgExecutor } from './sql/executor.js';
import { createPgPool } from './sql/pg-pool.js';
import { ALL_TOOLS } from './tools/index.js';

const usage = `Configuration is read from the environment (POSTGRES_* names, libpq PG* aliases, or POSTGRES_URL):
  POSTGRES_HOST (required)         POSTGRES_PORT (5432)
  POSTGRES_USER (required)         POSTGRES_PASSWORD (optional for trust auth)
  POSTGRES_DATABASE                POSTGRES_DATABASES (comma-separated allowlist)
  POSTGRES_URL                     postgresql://user:pass@host:port/db?sslmode=...
  POSTGRES_SSL (require)           false | require | verify
  POSTGRES_READ_ONLY (true)        POSTGRES_MAX_ROWS (1000)
  POSTGRES_CONNECTION_TIMEOUT (8000 ms)  POSTGRES_REQUEST_TIMEOUT (30000 ms)
  POSTGRES_POOL_MAX (10)           POSTGRES_APPLICATION_NAME (qodalis-mcp-postgres)
  POSTGRES_QUERY_LOG (false)       POSTGRES_ENV_FILE (same as --env-file)
`;

void runCli({
    createRuntime: (config, log) => {
        const manager = new PoolManager({ createPool: createPgPool(config), log });
        return {
            closeAll: () => manager.closeAll(),
            executor: new PgExecutor(manager, { maxRows: config.maxRows }),
            poolState: (database) => manager.describe(database),
        };
    },
    dialect: postgresDialect,
    envFileVariables: ENV_FILE_VARIABLES,
    loadConfig,
    packageName: SERVER_NAME,
    tools: ALL_TOOLS,
    usage,
    version: SERVER_VERSION,
    websiteUrl: WEBSITE_URL,
});
