import { createRequire } from 'node:module';
import {
    createServer,
    type IQueryExecutor,
    type PoolState,
    type ToolConfig,
} from '@qodalis/mcp-sql-core';
import type { McpServer } from '@modelcontextprotocol/server';
import { sqliteDialect } from './dialect.js';
import { ALL_TOOLS } from './tools/index.js';

const require = createRequire(import.meta.url);

const readPackageJson = (): { name: string; version: string } => {
    for (const candidate of ['../package.json', '../../package.json']) {
        try {
            return require(candidate) as { name: string; version: string };
        } catch {
            // try the next location
        }
    }
    return { name: '@qodalis/mcp-sqlite', version: '0.0.0' };
};

const packageJson = readPackageJson();

export const SERVER_NAME = packageJson.name;
export const SERVER_VERSION = packageJson.version;
export const WEBSITE_URL = 'https://github.com/qodalis-solutions/mcp-sql';
export const TOOL_NAMES: readonly string[] = ALL_TOOLS.map((tool) => tool.name);

export type SqliteDependencies = {
    config: ToolConfig;
    executor: IQueryExecutor;
    poolState: (database: string | undefined) => PoolState;
};

/** Builds the MCP server with every SQLite tool registered. */
export const createSqliteServer = (deps: SqliteDependencies): McpServer =>
    createServer({
        ...deps,
        dialect: sqliteDialect,
        name: SERVER_NAME,
        tools: ALL_TOOLS,
        version: SERVER_VERSION,
        websiteUrl: WEBSITE_URL,
    });
