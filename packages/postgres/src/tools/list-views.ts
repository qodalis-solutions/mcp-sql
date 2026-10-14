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
    n.nspname as "schema",
    c.relname as "name",
    case c.relkind when 'm' then 'materialized view' else 'view' end as "kind",
    obj_description(c.oid, 'pg_class') as "comment"
from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
where
    c.relkind in ('v', 'm') and
    (@schema::text is not null and n.nspname = @schema or
     @schema::text is null and n.nspname not in ('pg_catalog', 'information_schema')) and
    (@namePattern::text is null or c.relname ilike @namePattern escape '\\')
order by n.nspname, c.relname`;

export const listViewsTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_views',
    title: 'List views',
    description:
        'Lists views and materialized views. Filter by schema or name substring. Use get_object_definition for the SQL.',
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
