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
        .describe('A single table to measure. Omit to list the largest tables.'),
    top: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(25)
        .describe('How many tables to return when no table is given.'),
});

const buildSql = (scoped: boolean): string => `
select
    n.nspname as "schema",
    c.relname as "table",
    greatest(coalesce(s.n_live_tup, 0), greatest(c.reltuples, 0)::bigint) as "rowCount",
    s.n_dead_tup as "deadRows",
    pg_total_relation_size(c.oid) / 1024 as "totalKb",
    pg_relation_size(c.oid) / 1024 as "dataKb",
    pg_indexes_size(c.oid) / 1024 as "indexKb",
    (pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid)) / 1024 as "toastKb",
    (select count(*) from pg_index as i where i.indrelid = c.oid) as "indexCount",
    s.last_vacuum as "lastVacuum",
    s.last_autovacuum as "lastAutovacuum",
    s.last_analyze as "lastAnalyze"
from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    left join pg_stat_user_tables as s on s.relid = c.oid
where c.relkind in ('r', 'p', 'm')${
    scoped
        ? ' and n.nspname = @schema and c.relname = @table'
        : " and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'"
}
order by pg_total_relation_size(c.oid) desc${scoped ? '' : '\nlimit @top'}`;

export const getTableStatsTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_table_stats',
    title: 'Get table statistics',
    description:
        'Row estimates, dead rows, data/index/TOAST size in KB, index count and vacuum timestamps, for one table or the largest tables.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const scoped = args.table !== undefined;
        const params = scoped
            ? objectParams(context.dialect, args.table ?? '', args.schema).params
            : { top: args.top };
        const result = await context.executor.run({
            database,
            params,
            signal: context.signal,
            sql: buildSql(scoped),
        });
        return resultOutput(result);
    },
};
