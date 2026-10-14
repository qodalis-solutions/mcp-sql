import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { CommonConfig } from '../config.js';
import type { Dialect } from '../dialect.js';
import { normalizeValue } from '../format.js';
import { isConnectionError, toPublicError, type PublicError } from '../sql/errors.js';
import type { IQueryExecutor, QueryResult } from '../sql/executor.js';
import type { PoolState } from '../sql/pool-manager.js';

export type ToolConfig = Pick<
    CommonConfig,
    'allowedDatabases' | 'database' | 'maxRows' | 'password' | 'readOnly' | 'server' | 'user'
>;

export type ToolContext = {
    config: ToolConfig;
    dialect: Dialect;
    executor: IQueryExecutor;
    poolState: (database: string | undefined) => PoolState;
    signal?: AbortSignal | undefined;
};

export type ToolOutput = {
    isError?: boolean;
    structured?: Record<string, unknown>;
    text: string;
};

export type ToolDefinition<TSchema extends z.ZodObject<z.ZodRawShape>> = {
    annotations: ToolAnnotations;
    description: string;
    handler: (args: z.infer<TSchema>, context: ToolContext) => Promise<ToolOutput>;
    inputSchema: TSchema;
    name: string;
    title: string;
};

export type AnyToolDefinition = ToolDefinition<z.ZodObject<z.ZodRawShape>>;

export class ToolInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ToolInputError';
    }
}

/** Picks the database for a call, enforcing the configured allowlist. */
export const resolveDatabase = (
    context: ToolContext,
    requested: string | undefined,
): string | undefined => {
    const { allowedDatabases, database } = context.config;
    if (!requested) {
        return database;
    }
    const hasAllowlist = allowedDatabases.length > 0;
    if (!hasAllowlist) {
        return requested;
    }
    const match = allowedDatabases.find((name) => name.toLowerCase() === requested.toLowerCase());
    if (!match) {
        throw new ToolInputError(
            `Database "${requested}" is not available through this server. Allowed: ${allowedDatabases.join(', ')}.`,
        );
    }
    return match;
};

/** Converts a result set into plain objects keyed by column name. */
export const rowsToObjects = (result: QueryResult): Array<Record<string, unknown>> =>
    result.rows.map((row) => {
        const record: Record<string, unknown> = {};
        result.columns.forEach((column, index) => {
            record[column.name] = normalizeValue(row[index]);
        });
        return record;
    });

export const firstRow = (result: QueryResult): Record<string, unknown> | undefined =>
    rowsToObjects(result)[0];

export const CONNECTION_HINT =
    'The database host was not reachable. Check the network or VPN, then retry: the server reconnects automatically on the next call.';

const describeError = (error: PublicError, isConnection: boolean): string => {
    const parts = [`Error${error.code ? ` ${error.code}` : ''}`];
    if (error.number !== undefined) {
        parts.push(`(${error.number})`);
    }
    if (error.lineNumber !== undefined) {
        parts.push(`at line ${error.lineNumber}`);
    }
    const head = `${parts.join(' ')}: ${error.message}`;
    return isConnection ? `${head}\n${CONNECTION_HINT}` : head;
};

/** Runs a tool handler and maps every outcome to a CallToolResult. */
export const runTool = async <TSchema extends z.ZodObject<z.ZodRawShape>>(
    tool: ToolDefinition<TSchema>,
    args: unknown,
    context: ToolContext,
): Promise<CallToolResult> => {
    try {
        const parsed = tool.inputSchema.parse(args ?? {}) as z.infer<TSchema>;
        const output = await tool.handler(parsed, context);
        return {
            content: [{ type: 'text', text: output.text }],
            ...(output.structured ? { structuredContent: output.structured } : {}),
            ...(output.isError ? { isError: true } : {}),
        };
    } catch (error) {
        const secrets = [context.config.password];
        const publicError = toPublicError(error, secrets);
        return {
            content: [{ type: 'text', text: describeError(publicError, isConnectionError(error)) }],
            isError: true,
        };
    }
};
