import { z } from 'zod';
import {
    databaseArg,
    objectParams,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    resultOutput,
    schemaArg,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

const inputSchema = z.object({
    columns: z
        .array(z.string().trim().min(1))
        .min(1)
        .optional()
        .describe('Columns to return. Defaults to all.'),
    database: databaseArg,
    limit: z.number().int().min(1).max(1000).default(10).describe('Number of rows. Default 10.'),
    random: z
        .boolean()
        .default(false)
        .describe('Pick random rows instead of the first ones (slower on big tables).'),
    schema: schemaArg,
    table: z.string().trim().min(1).describe('Table or view name, optionally schema-qualified.'),
});

export const sampleDataTool: ToolDefinition<typeof inputSchema> = {
    name: 'sample_data',
    title: 'Sample data',
    description: 'Returns a few rows from a table or view to see what the data looks like.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const { object } = objectParams(context.dialect, args.table, args.schema);
        const { quoteIdentifier, qualifiedName } = context.dialect.identifiers;
        const columns = args.columns ? args.columns.map(quoteIdentifier).join(', ') : '*';
        const order = args.random ? ' order by random()' : '';
        const result = await context.executor.run({
            database,
            maxRows: args.limit,
            params: { limit: args.limit },
            signal: context.signal,
            sql: `select ${columns} from ${qualifiedName(object)}${order} limit @limit`,
        });
        return resultOutput(result);
    },
};
