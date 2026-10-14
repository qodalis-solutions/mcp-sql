import { z } from 'zod';
import { resolveDatabase, rowsToObjects, ToolInputError, type ToolDefinition } from './context.js';
import {
    databaseArg,
    jsonOutput,
    objectParams,
    READ_ONLY_ANNOTATIONS,
    schemaArg,
} from './shared.js';

const inputSchema = z.object({
    database: databaseArg,
    schema: schemaArg,
    table: z
        .string()
        .trim()
        .min(1)
        .describe('Table name, optionally schema-qualified ("sales.Orders").'),
});

const OBJECT_ID = `object_id(quotename(@schema) + '.' + quotename(@table), 'U')`;

const COLUMNS_SQL = `
select
    [c].[name] as [name],
    [ty].[name] +
        case
            when [ty].[name] in ('varchar', 'char', 'varbinary', 'binary') then '(' + case when [c].[max_length] = -1 then 'max' else cast([c].[max_length] as varchar(10)) end + ')'
            when [ty].[name] in ('nvarchar', 'nchar') then '(' + case when [c].[max_length] = -1 then 'max' else cast([c].[max_length] / 2 as varchar(10)) end + ')'
            when [ty].[name] in ('decimal', 'numeric') then '(' + cast([c].[precision] as varchar(10)) + ',' + cast([c].[scale] as varchar(10)) + ')'
            when [ty].[name] in ('datetime2', 'time', 'datetimeoffset') then '(' + cast([c].[scale] as varchar(10)) + ')'
            else ''
        end as [type],
    [c].[is_nullable] as [nullable],
    [c].[is_identity] as [identity],
    [c].[is_computed] as [computed],
    [d].[definition] as [default]
from sys.columns as [c]
    join sys.types as [ty] on [ty].[user_type_id] = [c].[user_type_id]
    left join sys.default_constraints as [d] on [d].[object_id] = [c].[default_object_id]
where [c].[object_id] = ${OBJECT_ID}
order by [c].[column_id]`;

const INDEXES_SQL = `
select
    [i].[name] as [name],
    [i].[type_desc] as [type],
    [i].[is_primary_key] as [is_primary_key],
    [i].[is_unique] as [is_unique],
    [i].[is_unique_constraint] as [is_unique_constraint],
    [i].[filter_definition] as [filter],
    stuff((
        select ', ' + [c].[name] + case when [ic].[is_descending_key] = 1 then ' desc' else '' end
        from sys.index_columns as [ic]
            join sys.columns as [c] on [c].[object_id] = [ic].[object_id] and [c].[column_id] = [ic].[column_id]
        where [ic].[object_id] = [i].[object_id] and [ic].[index_id] = [i].[index_id] and [ic].[is_included_column] = 0
        order by [ic].[key_ordinal]
        for xml path(''), type).value('.', 'nvarchar(max)'), 1, 2, '') as [columns],
    stuff((
        select ', ' + [c].[name]
        from sys.index_columns as [ic]
            join sys.columns as [c] on [c].[object_id] = [ic].[object_id] and [c].[column_id] = [ic].[column_id]
        where [ic].[object_id] = [i].[object_id] and [ic].[index_id] = [i].[index_id] and [ic].[is_included_column] = 1
        order by [ic].[index_column_id]
        for xml path(''), type).value('.', 'nvarchar(max)'), 1, 2, '') as [included]
from sys.indexes as [i]
where [i].[object_id] = ${OBJECT_ID} and [i].[type] <> 0
order by [i].[is_primary_key] desc, [i].[name]`;

const FOREIGN_KEYS_SQL = `
select
    [fk].[name] as [name],
    case when [fk].[parent_object_id] = ${OBJECT_ID} then 'outgoing' else 'incoming' end as [direction],
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
    [fk].[update_referential_action_desc] as [onUpdate]
from sys.foreign_keys as [fk]
    join sys.objects as [po] on [po].[object_id] = [fk].[parent_object_id]
    join sys.objects as [ro] on [ro].[object_id] = [fk].[referenced_object_id]
where [fk].[parent_object_id] = ${OBJECT_ID} or [fk].[referenced_object_id] = ${OBJECT_ID}
order by [direction], [fk].[name]`;

export const describeTableTool: ToolDefinition<typeof inputSchema> = {
    name: 'describe_table',
    title: 'Describe table',
    description:
        'Returns the columns (with full type, nullability, identity, computed flag and default), indexes (with key and included columns) and foreign keys (both directions) of a table.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const { object, params } = objectParams(args.table, args.schema);
        const run = (sql: string) =>
            context.executor.run({ database, params, signal: context.signal, sql });

        const columns = rowsToObjects(await run(COLUMNS_SQL));
        if (columns.length === 0) {
            throw new ToolInputError(
                `Table ${object.schema}.${object.name} was not found in ${database ?? 'the current database'}.`,
            );
        }
        const [indexes, foreignKeys] = await Promise.all([run(INDEXES_SQL), run(FOREIGN_KEYS_SQL)]);

        return jsonOutput({
            table: `${object.schema}.${object.name}`,
            columns,
            indexes: rowsToObjects(indexes),
            foreignKeys: rowsToObjects(foreignKeys),
        });
    },
};
