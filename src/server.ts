import { McpServer } from '@modelcontextprotocol/server';
import { createRequire } from 'node:module';
import type { IQueryExecutor } from './sql/executor.js';
import type { PoolState } from './sql/pool-manager.js';
import { runTool, type ToolConfig, type ToolContext } from './tools/context.js';
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
export const TOOL_NAMES: readonly string[] = ALL_TOOLS.map((tool) => tool.name);

export type ServerDependencies = {
    config: ToolConfig;
    executor: IQueryExecutor;
    poolState: (database: string | undefined) => PoolState;
};

const buildInstructions = (config: ToolConfig): string => {
    const databases =
        config.allowedDatabases.length > 0
            ? `Databases available: ${config.allowedDatabases.join(', ')} (default: ${config.database ?? config.allowedDatabases[0]}).`
            : `Default database: ${config.database ?? 'server default'}.`;
    const mode = config.readOnly
        ? 'This server runs in read-only mode: execute_query accepts SELECT/WITH batches and work on #temp tables or @table variables, and rejects INSERT/UPDATE/DELETE/DDL against persistent tables.'
        : 'This server runs in WRITE mode: execute_query accepts INSERT/UPDATE/DELETE and DDL. Server-level statements (xp_cmdshell, backups, logins, configuration) are always blocked.';
    return [
        `SQL Server MCP server for ${config.server}.`,
        databases,
        mode,
        `Results are capped at ${config.maxRows} rows and flagged when truncated; narrow queries with WHERE or TOP.`,
        'Prefer named parameters (@name with the params object) over string interpolation.',
        'Start with search_objects or list_tables to find objects, describe_table for structure, then execute_query.',
        'Connections heal themselves: after a network or VPN interruption simply retry the call, the pool reconnects automatically.',
    ].join('\n');
};

/** Builds the MCP server with every tool registered. */
export const createServer = (deps: ServerDependencies): McpServer => {
    const server = new McpServer(
        {
            name: SERVER_NAME,
            version: SERVER_VERSION,
            websiteUrl: 'https://github.com/qodalis-solutions/mcp-sql',
        },
        { instructions: buildInstructions(deps.config) },
    );

    for (const tool of ALL_TOOLS) {
        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.description,
                inputSchema: tool.inputSchema,
                annotations: tool.annotations,
            },
            async (args, ctx) => {
                const context: ToolContext = {
                    config: deps.config,
                    executor: deps.executor,
                    poolState: deps.poolState,
                    signal: ctx.mcpReq?.signal,
                };
                return runTool(tool, args, context);
            },
        );
    }

    return server;
};
