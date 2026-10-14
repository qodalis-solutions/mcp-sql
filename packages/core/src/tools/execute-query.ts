import { z } from 'zod';
import { formatResult } from '../format.js';
import { validateSql } from '../sql/guard.js';
import { resolveDatabase, ToolInputError, type ToolDefinition } from './context.js';
import { databaseArg } from './shared.js';

const inputSchema = z.object({
    database: databaseArg,
    format: z
        .enum(['json', 'markdown', 'csv'])
        .default('json')
        .describe('Output format. json is the most compact.'),
    maxRows: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Row cap for this call. Cannot exceed the server-wide maximum.'),
    params: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional()
        .describe(
            'Named parameters referenced as @name in the SQL. Always prefer these over string interpolation.',
        ),
    sql: z.string().trim().min(1).describe('SQL to execute. Multiple statements are allowed.'),
});

export const executeQueryTool: ToolDefinition<typeof inputSchema> = {
    name: 'execute_query',
    title: 'Execute query',
    description:
        'Runs SQL with named parameters and returns the result set (columns listed once, rows as arrays). In read-only mode only reads and session-local temp-table work are allowed. Results are capped at the configured maximum and flagged when truncated.',
    inputSchema,
    annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
    },
    handler: async (args, context) => {
        const verdict = validateSql(
            args.sql,
            { readOnly: context.config.readOnly },
            context.dialect.guard,
        );
        if (!verdict.ok) {
            throw new ToolInputError(
                verdict.reason.replace(
                    'disable read-only mode',
                    `set ${context.dialect.readOnlyVariable}=false`,
                ),
            );
        }
        const database = resolveDatabase(context, args.database);
        const maxRows = Math.min(args.maxRows ?? context.config.maxRows, context.config.maxRows);
        const result = await context.executor.run({
            database,
            maxRows,
            params: args.params,
            signal: context.signal,
            sql: args.sql,
        });
        return { text: formatResult(result, args.format) };
    },
};
