/**
 * @qodalis/mcp-sql-core — shared building blocks for resilient SQL MCP servers.
 */
export { ConfigError, createEnvReader, envNames, loadCommonConfig } from './config.js';
export type { CommonConfig, CommonKey, Env, EnvReader, EnvSpec } from './config.js';
export type { Dialect } from './dialect.js';
export { applyEnvFile, parseEnvFile } from './env-file.js';
export { formatResult, normalizeValue, type OutputFormat } from './format.js';
export { createLogger, runCli, type CliSpec, type Runtime } from './cli.js';
export { createServer, type ServerDependencies } from './server.js';
export { isConnectionError, redactSecrets, toPublicError, type PublicError } from './sql/errors.js';
export { AbortedError } from './sql/executor.js';
export type {
    ColumnInfo,
    ExecutorDefaults,
    IQueryExecutor,
    QueryResult,
    RunOptions,
} from './sql/executor.js';
export { scrubSql, validateSql } from './sql/guard.js';
export type {
    GuardOptions,
    GuardProfile,
    GuardResult,
    GuardRule,
    ScrubOptions,
    SessionLocalContext,
    TargetedWrite,
} from './sql/guard.js';
export { createIdentifierTools } from './sql/identifiers.js';
export type { IdentifierStyle, IdentifierTools, ObjectName } from './sql/identifiers.js';
export { PoolManager } from './sql/pool-manager.js';
export type { PoolLike, PoolManagerOptions, PoolState } from './sql/pool-manager.js';
export {
    CONNECTION_HINT,
    firstRow,
    resolveDatabase,
    rowsToObjects,
    runTool,
    ToolInputError,
} from './tools/context.js';
export type {
    AnyToolDefinition,
    ToolConfig,
    ToolContext,
    ToolDefinition,
    ToolOutput,
} from './tools/context.js';
export { executeQueryTool } from './tools/execute-query.js';
export {
    databaseArg,
    jsonOutput,
    likePattern,
    type LikeEscapeStyle,
    nameContainsArg,
    objectParams,
    READ_ONLY_ANNOTATIONS,
    resultOutput,
    schemaArg,
} from './tools/shared.js';
export { testConnectionTool } from './tools/test-connection.js';
