/**
 * @qodalis/mcp-oracle — resilient MCP server for Oracle Database.
 * Re-exports the core so embedders need a single import.
 */
export * from '@qodalis/mcp-sql-core';
export {
    ConfigError,
    ENV_FILE_VARIABLES,
    ENV_SPEC,
    loadConfig,
    normalizeSchemaName,
    type Config,
} from './config.js';
export { guardProfile, identifiers, oracleDialect } from './dialect.js';
export {
    createOracleServer,
    SERVER_NAME,
    SERVER_VERSION,
    TOOL_NAMES,
    WEBSITE_URL,
    type OracleDependencies,
} from './server.js';
export {
    OracleExecutor,
    type OracleConnectionLike,
    type OracleExecuteOptions,
    type OracleExecuteResult,
    type OracleExecutorDefaults,
    type OraclePoolLike,
    type OracleResultSetLike,
} from './sql/executor.js';
export { splitStatements, toBindParams, type BindQuery } from './sql/params.js';
export {
    createOraclePool,
    fetchTypeHandler,
    OraclePool,
    toPoolAttributes,
    type OraclePoolOptions,
} from './sql/oracle-pool.js';
export { normalizeCell, typeNameFor } from './sql/types.js';
export { ALL_TOOLS } from './tools/index.js';
export { resolveSchema, SYSTEM_SCHEMAS } from './tools/shared.js';
