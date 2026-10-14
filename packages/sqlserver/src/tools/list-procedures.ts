import { z } from 'zod';
import {
    databaseArg,
    likePattern,
    nameContainsArg,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    resultOutput,
    schemaArg,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

const inputSchema = z.object({
    database: databaseArg,
    kind: z
        .enum(['all', 'function', 'procedure'])
        .default('all')
        .describe('Restrict to procedures or functions.'),
    nameContains: nameContainsArg,
    schema: schemaArg,
});

const SQL = `
select
    [s].[name] as [schema],
    [o].[name] as [name],
    case [o].[type]
        when 'P' then 'procedure'
        when 'PC' then 'procedure'
        when 'FN' then 'scalar function'
        when 'IF' then 'inline table function'
        when 'TF' then 'table function'
        when 'FS' then 'clr scalar function'
        when 'FT' then 'clr table function'
    end as [kind],
    [o].[create_date] as [createDate],
    [o].[modify_date] as [modifyDate]
from sys.objects as [o]
    join sys.schemas as [s] on [s].[schema_id] = [o].[schema_id]
where
    [o].[is_ms_shipped] = 0 and
    [o].[type] in ('P', 'PC', 'FN', 'IF', 'TF', 'FS', 'FT') and
    (@kind = 'all' or
        (@kind = 'procedure' and [o].[type] in ('P', 'PC')) or
        (@kind = 'function' and [o].[type] in ('FN', 'IF', 'TF', 'FS', 'FT'))) and
    (@schema is null or [s].[name] = @schema) and
    (@namePattern is null or [o].[name] like @namePattern)
order by [s].[name], [o].[name]`;

export const listProceduresTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_procedures',
    title: 'List procedures and functions',
    description:
        'Lists stored procedures and user-defined functions. Use get_object_definition to read their source.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({
            database,
            params: {
                kind: args.kind,
                schema: args.schema ?? null,
                namePattern: likePattern(args.nameContains, context.dialect.likeEscape),
            },
            signal: context.signal,
            sql: SQL,
        });
        return resultOutput(result);
    },
};
