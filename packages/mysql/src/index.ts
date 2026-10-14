/**
 * @qodalis/mcp-mysql — resilient MCP server for MySQL and MariaDB.
 * Re-exports the core so embedders need a single import.
 */
export * from '@qodalis/mcp-sql-core';
export {
    ConfigError,
    ENV_FILE_VARIABLES,
    ENV_SPEC,
    loadConfig,
    type Config,
    type SslConfig,
} from './config.js';
export { guardProfile, identifiers, mysqlDialect } from './dialect.js';
export {
    createMysqlServer,
    SERVER_NAME,
    SERVER_VERSION,
    TOOL_NAMES,
    WEBSITE_URL,
    type MysqlDependencies,
} from './server.js';
export {
    MysqlExecutor,
    type MysqlConnectionLike,
    type MysqlExecutorDefaults,
    type MysqlField,
    type MysqlPoolLike,
    type MysqlQueryLike,
    type MysqlQueryOptions,
} from './sql/executor.js';
export { toPositionalParams, type PositionalQuery } from './sql/params.js';
export {
    createMysqlPool,
    MysqlPool,
    toMysqlConfig,
    type MysqlPoolOptions,
} from './sql/mysql-pool.js';
export { typeNameForColumn } from './sql/types.js';
export { ALL_TOOLS } from './tools/index.js';
