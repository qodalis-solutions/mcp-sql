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
    schema as "schema",
    name as "name",
    ncol as "columnCount"
from pragma_table_list
where
    type = 'view' and
    (@schema is null or schema = @schema) and
    (@namePattern is null or name like @namePattern escape '\\')
order by schema, name`;

export const listViewsTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_views',
    title: 'List views',
    description:
        'Lists views with their schema and column count. Filter by schema or name substring. Use get_object_definition for the SQL.',
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
