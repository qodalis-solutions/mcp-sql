import { createRequire } from 'node:module';
import {
    createServer,
    type IQueryExecutor,
    type PoolState,
    type ToolConfig,
} from '@qodalis/mcp-sql-core';
import type { McpServer } from '@modelcontextprotocol/server';
import { mysqlDialect } from './dialect.js';
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
    return { name: '@qodalis/mcp-mysql', version: '0.0.0' };
};

const packageJson = readPackageJson();

export const SERVER_NAME = packageJson.name;
export const SERVER_VERSION = packageJson.version;
export const WEBSITE_URL = 'https://github.com/qodalis-solutions/mcp-sql';
export const TOOL_NAMES: readonly string[] = ALL_TOOLS.map((tool) => tool.name);

export type MysqlDependencies = {
    config: ToolConfig;
    executor: IQueryExecutor;
    poolState: (database: string | undefined) => PoolState;
};

/** Builds the MCP server with every MySQL tool registered. */
export const createMysqlServer = (deps: MysqlDependencies): McpServer =>
    createServer({
        ...deps,
        dialect: mysqlDialect,
        name: SERVER_NAME,
        tools: ALL_TOOLS,
        version: SERVER_VERSION,
        websiteUrl: WEBSITE_URL,
    });
