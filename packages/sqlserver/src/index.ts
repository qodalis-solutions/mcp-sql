/**
 * @qodalis/mcp-sqlserver — resilient MCP server for Microsoft SQL Server.
 * Re-exports the core so embedders need a single import.
 */
export * from '@qodalis/mcp-sql-core';
export { ConfigError, ENV_FILE_VARIABLES, ENV_SPEC, loadConfig, type Config } from './config.js';
export { guardProfile, identifiers, sqlserverDialect } from './dialect.js';
export {
    createSqlServerServer,
    SERVER_NAME,
    SERVER_VERSION,
    TOOL_NAMES,
    WEBSITE_URL,
    type SqlServerDependencies,
} from './server.js';
export { SqlExecutor, type QueryPoolLike, type RequestLike } from './sql/executor.js';
export { createMssqlPool, toMssqlConfig } from './sql/mssql-pool.js';
export { ALL_TOOLS } from './tools/index.js';
