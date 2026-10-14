import { z } from 'zod';
import {
    databaseArg,
    nameContainsArg,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    schemaArg,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

const inputSchema = z.object({
    database: databaseArg,
    kind: z
        .enum(['all', 'function', 'procedure'])
        .default('all')
        .describe('Accepted for parity with the other dialects.'),
    nameContains: nameContainsArg,
    schema: schemaArg,
});

const NOTE =
    'SQLite has no stored procedures or user-defined routines stored in the database; logic lives in views and triggers. Use list_views, and get_object_definition for a trigger.';

export const listProceduresTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_procedures',
    title: 'List procedures and functions',
    description:
        'Kept for parity with the other dialect servers: SQLite stores no procedures or functions, so this always returns an empty list with an explanation.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        resolveDatabase(context, args.database);
        return { text: NOTE, structured: { columns: [], note: NOTE, rowCount: 0, rows: [] } };
    },
};
