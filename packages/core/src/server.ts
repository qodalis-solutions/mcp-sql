import { McpServer } from '@modelcontextprotocol/server';
import type { Dialect } from './dialect.js';
import type { IQueryExecutor } from './sql/executor.js';
import type { PoolState } from './sql/pool-manager.js';
import {
    runTool,
    type AnyToolDefinition,
    type ToolConfig,
    type ToolContext,
} from './tools/context.js';

export type ServerDependencies = {
    config: ToolConfig;
    dialect: Dialect;
    executor: IQueryExecutor;
    name: string;
    poolState: (database: string | undefined) => PoolState;
    tools: AnyToolDefinition[];
    version: string;
    websiteUrl?: string;
};

const buildInstructions = (deps: ServerDependencies): string => {
    const { config, dialect } = deps;
    const databases =
        config.allowedDatabases.length > 0
            ? `Databases available: ${config.allowedDatabases.join(', ')} (default: ${config.database ?? config.allowedDatabases[0]}).`
            : `Default database: ${config.database ?? 'server default'}.`;
    const mode = config.readOnly
        ? 'This server runs in read-only mode: execute_query accepts reads and work on session-local temporary objects, and rejects INSERT/UPDATE/DELETE/DDL against persistent tables.'
        : 'This server runs in WRITE mode: execute_query accepts INSERT/UPDATE/DELETE and DDL. Server-level statements (command execution, backups, logins, configuration) are always blocked.';
    return [
        `${dialect.displayName} MCP server for ${config.server}.`,
        databases,
        mode,
        `Results are capped at ${config.maxRows} rows and flagged when truncated; narrow queries with WHERE or a row limit.`,
        'Prefer named parameters (@name with the params object) over string interpolation.',
        'Start with search_objects or list_tables to find objects, describe_table for structure, then execute_query.',
        'Connections heal themselves: after a network or VPN interruption simply retry the call, the pool reconnects automatically.',
    ].join('\n');
};

/** Builds the MCP server with the given tools registered. */
export const createServer = (deps: ServerDependencies): McpServer => {
    const server = new McpServer(
        {
            name: deps.name,
            version: deps.version,
            ...(deps.websiteUrl ? { websiteUrl: deps.websiteUrl } : {}),
        },
        { instructions: buildInstructions(deps) },
    );

    for (const tool of deps.tools) {
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
                    dialect: deps.dialect,
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
