import { z } from 'zod';
import {
    databaseArg,
    likePattern,
    nameContainsArg,
    READ_ONLY_ANNOTATIONS,
    resultOutput,
    schemaArg,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';
import { resolveSchema } from './shared.js';

const inputSchema = z.object({
    database: databaseArg,
    nameContains: nameContainsArg,
    schema: schemaArg,
});

const SQL = `
select * from (
    select
        v.owner as "schema",
        v.view_name as "name",
        'view' as "kind",
        c.comments as "comment"
    from all_views v
        left join all_tab_comments c on c.owner = v.owner and c.table_name = v.view_name
    where v.owner = @schema
    union all
    select
        m.owner as "schema",
        m.mview_name as "name",
        'materialized view' as "kind",
        c.comments as "comment"
    from all_mviews m
        left join all_tab_comments c on c.owner = m.owner and c.table_name = m.mview_name
    where m.owner = @schema
)
where @namePattern is null or upper("name") like upper(@namePattern) escape '\\'
order by "name"`;

export const listViewsTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_views',
    title: 'List views',
    description:
        'Lists views and materialized views of a schema (the configured schema by default). Filter by name substring. Use get_object_definition for the SQL.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const { database, schema } = resolveSchema(context, args.schema, args.database);
        const result = await context.executor.run({
            database,
            params: {
                schema,
                namePattern: likePattern(args.nameContains, context.dialect.likeEscape),
            },
            signal: context.signal,
            sql: SQL,
        });
        return resultOutput(result);
    },
};
