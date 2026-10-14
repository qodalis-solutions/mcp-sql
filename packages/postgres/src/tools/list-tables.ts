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
    includeRowCounts: z
        .boolean()
        .default(true)
        .describe('Include the planner/statistics row estimate per table. Default true.'),
    nameContains: nameContainsArg,
    schema: schemaArg,
});

const buildSql = (includeRowCounts: boolean): string => `
select
    n.nspname as "schema",
    c.relname as "name",
    case c.relkind when 'p' then 'partitioned' else 'table' end as "kind",${
        includeRowCounts
            ? '\n    greatest(coalesce(s.n_live_tup, 0), greatest(c.reltuples, 0)::bigint) as "rowCount",'
            : ''
    }
    pg_size_pretty(pg_total_relation_size(c.oid)) as "size",
    obj_description(c.oid, 'pg_class') as "comment"
from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace${
        includeRowCounts ? '\n    left join pg_stat_user_tables as s on s.relid = c.oid' : ''
    }
where
    c.relkind in ('r', 'p') and
    (@schema::text is not null and n.nspname = @schema or
     @schema::text is null and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%') and
    (@namePattern::text is null or c.relname ilike @namePattern escape '\\')
order by n.nspname, c.relname`;

export const listTablesTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_tables',
    title: 'List tables',
    description:
        'Lists tables (ordinary and partitioned) with schema, estimated row count, size and comment. Filter by schema or name substring. System schemas are hidden unless a schema is given.',
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
            sql: buildSql(args.includeRowCounts),
        });
        return resultOutput(result);
    },
};
