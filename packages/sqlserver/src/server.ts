import { createRequire } from 'node:module';
import {
    createServer,
    type IQueryExecutor,
    type PoolState,
    type ToolConfig,
} from '@qodalis/mcp-sql-core';
import type { McpServer } from '@modelcontextprotocol/server';
import { sqlserverDialect } from './dialect.js';
import { ALL_TOOLS } from './tools/index.js';

const require = createRequire(import.meta.url);

/** package.json sits one level up from src/ and two levels up from dist/src/. */
const readPackageJson = (): { name: string; version: string } => {
    for (const candidate of ['../package.json', '../../package.json']) {
        try {
            return require(candidate) as { name: string; version: string };
        } catch {
            // try the next location
        }
    }
    return { name: '@qodalis/mcp-sqlserver', version: '0.0.0' };
};

const packageJson = readPackageJson();

export const SERVER_NAME = packageJson.name;
export const SERVER_VERSION = packageJson.version;
export const WEBSITE_URL = 'https://github.com/qodalis-solutions/mcp-sql';
export const TOOL_NAMES: readonly string[] = ALL_TOOLS.map((tool) => tool.name);

export type SqlServerDependencies = {
    config: ToolConfig;
    executor: IQueryExecutor;
    poolState: (database: string | undefined) => PoolState;
};

/** Builds the MCP server with every SQL Server tool registered. */
export const createSqlServerServer = (deps: SqlServerDependencies): McpServer =>
    createServer({
        ...deps,
        dialect: sqlserverDialect,
        name: SERVER_NAME,
        tools: ALL_TOOLS,
        version: SERVER_VERSION,
        websiteUrl: WEBSITE_URL,
    });
