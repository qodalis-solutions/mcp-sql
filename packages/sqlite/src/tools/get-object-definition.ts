import { z } from 'zod';
import {
    databaseArg,
    firstRow,
    objectParams,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    schemaArg,
    ToolInputError,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

const inputSchema = z.object({
    database: databaseArg,
    name: z
        .string()
        .trim()
        .min(1)
        .describe('Table, view, index or trigger name, optionally schema-qualified.'),
    schema: schemaArg,
});

export const getObjectDefinitionTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_object_definition',
    title: 'Get object definition',
    description: 'Returns the CREATE statement stored for a table, view, index or trigger.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const { object } = objectParams(context.dialect, args.name, args.schema);
        const schemaTable = `${context.dialect.identifiers.quoteIdentifier(object.schema)}.sqlite_schema`;
        const row = firstRow(
            await context.executor.run({
                database,
                params: { name: object.name },
                signal: context.signal,
                sql: `select type as "type", tbl_name as "table", sql as "definition" from ${schemaTable} where name = @name and sql is not null limit 1`,
            }),
        );
        const definition = row?.definition;
        if (typeof definition !== 'string') {
            throw new ToolInputError(
                `Object ${object.schema}.${object.name} was not found as a table, view, index or trigger.`,
            );
        }
        const header = `-- ${String(row?.type)} ${object.schema}.${object.name}\n`;
        return {
            text: header + definition,
            structured: {
                name: `${object.schema}.${object.name}`,
                type: row?.type,
                table: row?.table,
                definition,
            },
        };
    },
};
