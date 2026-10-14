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
    database: databaseArg,
    schema: schemaArg,
    table: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
            'Limit to relationships touching this table (either side). Omit for the whole database.',
        ),
});

const buildSql = (scoped: boolean): string => `
select
    [fk].[name] as [name],
    schema_name([po].[schema_id]) + '.' + [po].[name] as [fromTable],
    stuff((
        select ', ' + [c].[name]
        from sys.foreign_key_columns as [fkc]
            join sys.columns as [c] on [c].[object_id] = [fkc].[parent_object_id] and [c].[column_id] = [fkc].[parent_column_id]
        where [fkc].[constraint_object_id] = [fk].[object_id]
        order by [fkc].[constraint_column_id]
        for xml path(''), type).value('.', 'nvarchar(max)'), 1, 2, '') as [fromColumns],
    schema_name([ro].[schema_id]) + '.' + [ro].[name] as [toTable],
    stuff((
        select ', ' + [c].[name]
        from sys.foreign_key_columns as [fkc]
            join sys.columns as [c] on [c].[object_id] = [fkc].[referenced_object_id] and [c].[column_id] = [fkc].[referenced_column_id]
        where [fkc].[constraint_object_id] = [fk].[object_id]
        order by [fkc].[constraint_column_id]
        for xml path(''), type).value('.', 'nvarchar(max)'), 1, 2, '') as [toColumns],
    [fk].[delete_referential_action_desc] as [onDelete],
    [fk].[update_referential_action_desc] as [onUpdate],
    [fk].[is_disabled] as [disabled]
from sys.foreign_keys as [fk]
    join sys.objects as [po] on [po].[object_id] = [fk].[parent_object_id]
    join sys.objects as [ro] on [ro].[object_id] = [fk].[referenced_object_id]
${
    scoped
        ? `where [fk].[parent_object_id] = object_id(quotename(@schema) + '.' + quotename(@table), 'U') or
      [fk].[referenced_object_id] = object_id(quotename(@schema) + '.' + quotename(@table), 'U')`
        : ''
}
order by [fromTable], [fk].[name]`;

export const getForeignKeysTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_foreign_keys',
    title: 'Get foreign keys',
    description:
        'Lists foreign key relationships with their columns and referential actions, for one table (both directions) or the whole database.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const scoped = args.table !== undefined;
        const params = scoped
            ? objectParams(context.dialect, args.table ?? '', args.schema).params
            : {};
        const result = await context.executor.run({
            database,
            params,
            signal: context.signal,
            sql: buildSql(scoped),
        });
        return resultOutput(result);
    },
};
