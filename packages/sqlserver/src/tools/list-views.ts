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
    nameContains: nameContainsArg,
    schema: schemaArg,
});

const SQL = `
select
    [s].[name] as [schema],
    [v].[name] as [name],
    [v].[create_date] as [createDate],
    [v].[modify_date] as [modifyDate]
from sys.views as [v]
    join sys.schemas as [s] on [s].[schema_id] = [v].[schema_id]
where
    [v].[is_ms_shipped] = 0 and
    (@schema is null or [s].[name] = @schema) and
    (@namePattern is null or [v].[name] like @namePattern)
order by [s].[name], [v].[name]`;

export const listViewsTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_views',
    title: 'List views',
    description:
        'Lists views with schema and timestamps. Filter by schema or name substring. Use get_object_definition for the SQL.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({
            database,
            params: {
                schema: args.schema ?? null,
                namePattern: likePattern(args.nameContains, context.dialect.likeEscape),
            },
            signal: context.signal,
            sql: SQL,
        });
        return resultOutput(result);
    },
};
