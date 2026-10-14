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

const REL = `(select c.oid from pg_class as c join pg_namespace as n on n.oid = c.relnamespace where n.nspname = @schema and c.relname = @table)`;

const buildSql = (scoped: boolean): string => `
select
    con.conname as "name",
    fn.nspname || '.' || fc.relname as "fromTable",
    (select string_agg(a.attname, ', ' order by k.ord)
        from unnest(con.conkey) with ordinality as k(attnum, ord)
        join pg_attribute as a on a.attrelid = con.conrelid and a.attnum = k.attnum) as "fromColumns",
    tn.nspname || '.' || tc.relname as "toTable",
    (select string_agg(a.attname, ', ' order by k.ord)
        from unnest(con.confkey) with ordinality as k(attnum, ord)
        join pg_attribute as a on a.attrelid = con.confrelid and a.attnum = k.attnum) as "toColumns",
    case con.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as "onDelete",
    case con.confupdtype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as "onUpdate",
    not con.convalidated as "notValidated"
from pg_constraint as con
    join pg_class as fc on fc.oid = con.conrelid
    join pg_namespace as fn on fn.oid = fc.relnamespace
    join pg_class as tc on tc.oid = con.confrelid
    join pg_namespace as tn on tn.oid = tc.relnamespace
where con.contype = 'f'${scoped ? ` and (con.conrelid = ${REL} or con.confrelid = ${REL})` : " and fn.nspname not in ('pg_catalog', 'information_schema')"}
order by "fromTable", con.conname`;

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
