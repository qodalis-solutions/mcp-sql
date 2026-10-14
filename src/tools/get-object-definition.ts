import { z } from 'zod';
import { firstRow, resolveDatabase, ToolInputError, type ToolDefinition } from './context.js';
import { databaseArg, objectParams, READ_ONLY_ANNOTATIONS, schemaArg } from './shared.js';

const inputSchema = z.object({
    database: databaseArg,
    name: z
        .string()
        .trim()
        .min(1)
        .describe('View, procedure, function or trigger name, optionally schema-qualified.'),
    schema: schemaArg,
});

const SQL = `
select
    [o].[type_desc] as [type],
    [m].[definition] as [definition],
    [o].[create_date] as [createDate],
    [o].[modify_date] as [modifyDate]
from sys.objects as [o]
    left join sys.sql_modules as [m] on [m].[object_id] = [o].[object_id]
where [o].[object_id] = object_id(quotename(@schema) + '.' + quotename(@table))`;

const MODULE_TYPES = new Set([
    'VIEW',
    'SQL_STORED_PROCEDURE',
    'SQL_SCALAR_FUNCTION',
    'SQL_INLINE_TABLE_VALUED_FUNCTION',
    'SQL_TABLE_VALUED_FUNCTION',
    'SQL_TRIGGER',
]);

const explainMissing = (row: Record<string, unknown> | undefined): string => {
    if (!row) {
        return 'was not found';
    }
    const type = String(row.type);
    if (MODULE_TYPES.has(type)) {
        return `is a ${type} but its definition is not visible: the login needs VIEW DEFINITION permission on it, or the module is encrypted (WITH ENCRYPTION)`;
    }
    return `is a ${type} and has no T-SQL module definition; use describe_table for tables`;
};

export const getObjectDefinitionTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_object_definition',
    title: 'Get object definition',
    description: 'Returns the T-SQL source of a view, stored procedure, function or trigger.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const { object, params } = objectParams(args.name, args.schema);
        const row = firstRow(
            await context.executor.run({ database, params, signal: context.signal, sql: SQL }),
        );
        const definition = row?.definition;
        if (typeof definition !== 'string') {
            throw new ToolInputError(
                `Object ${object.schema}.${object.name} ${explainMissing(row)}.`,
            );
        }
        const header = `-- ${String(row?.type ?? 'OBJECT')} ${object.schema}.${object.name} (modified ${String(row?.modifyDate ?? 'unknown')})\n`;
        return {
            text: header + definition,
            structured: {
                name: `${object.schema}.${object.name}`,
                type: row?.type,
                definition,
                modifyDate: row?.modifyDate,
            },
        };
    },
};
