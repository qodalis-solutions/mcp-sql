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
    n.nspname as "schema",
    p.proname as "name",
    case p.prokind when 'p' then 'procedure' when 'a' then 'aggregate' when 'w' then 'window function' else 'function' end as "kind",
    l.lanname as "language",
    pg_get_function_arguments(p.oid) as "arguments",
    case when p.prokind = 'p' then null else pg_get_function_result(p.oid) end as "returns",
    obj_description(p.oid, 'pg_proc') as "comment"
from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    join pg_language as l on l.oid = p.prolang
where
    (@kind = 'all' or (@kind = 'procedure' and p.prokind = 'p') or (@kind = 'function' and p.prokind <> 'p')) and
    (@schema::text is not null and n.nspname = @schema or
     @schema::text is null and n.nspname not in ('pg_catalog', 'information_schema')) and
    (@namePattern::text is null or p.proname ilike @namePattern escape '\\')
order by n.nspname, p.proname`;

export const listProceduresTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_procedures',
    title: 'List procedures and functions',
    description:
        'Lists user-defined functions and procedures with language, arguments and return type. Use get_object_definition for the source.',
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
