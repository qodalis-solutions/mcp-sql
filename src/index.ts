/**
 * Public library surface, for embedding the server in another process or
 * reusing the resilient SQL Server access layer without MCP.
 */
export { ConfigError, loadConfig, type Config, type Env } from './config.js';
export { applyEnvFile, parseEnvFile } from './env-file.js';
export { formatResult, normalizeValue, type OutputFormat } from './format.js';
export {
    createServer,
    SERVER_NAME,
    SERVER_VERSION,
    TOOL_NAMES,
    type ServerDependencies,
} from './server.js';
export { isConnectionError, redactSecrets, toPublicError, type PublicError } from './sql/errors.js';
export {
    AbortedError,
    SqlExecutor,
    type ColumnInfo,
    type IQueryExecutor,
    type QueryPoolLike,
    type QueryResult,
    type RequestLike,
    type RunOptions,
} from './sql/executor.js';
export { scrubSql, validateSql, type GuardOptions, type GuardResult } from './sql/guard.js';
export {
    parseObjectName,
    qualifiedName,
    quoteIdentifier,
    type ObjectName,
} from './sql/identifiers.js';
export { createMssqlPool, toMssqlConfig } from './sql/mssql-pool.js';
export {
    PoolManager,
    type PoolLike,
    type PoolManagerOptions,
    type PoolState,
} from './sql/pool-manager.js';
export {
    resolveDatabase,
    runTool,
    ToolInputError,
    type AnyToolDefinition,
    type ToolConfig,
    type ToolContext,
    type ToolDefinition,
    type ToolOutput,
} from './tools/context.js';
export { ALL_TOOLS } from './tools/index.js';
