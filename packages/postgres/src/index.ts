/**
 * @qodalis/mcp-postgres — resilient MCP server for PostgreSQL.
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
export { guardProfile, identifiers, postgresDialect } from './dialect.js';
export {
    createPostgresServer,
    SERVER_NAME,
    SERVER_VERSION,
    TOOL_NAMES,
    WEBSITE_URL,
    type PostgresDependencies,
} from './server.js';
export {
    PgExecutor,
    type PgClientLike,
    type PgCursorLike,
    type PgPoolLike,
    type PgSimpleResult,
} from './sql/executor.js';
export { toPositionalParams, type PositionalQuery } from './sql/params.js';
export {
    createPgPool,
    PgPool,
    resultTypes,
    toPgConfig,
    type PgPoolOptions,
} from './sql/pg-pool.js';
export { typeNameForOid } from './sql/types.js';
export { ALL_TOOLS } from './tools/index.js';
