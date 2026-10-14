import { z } from 'zod';
import {
    databaseArg,
    jsonOutput,
    objectParams,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    rowsToObjects,
    schemaArg,
    ToolInputError,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

const inputSchema = z.object({
    database: databaseArg,
    schema: schemaArg,
    table: z
        .string()
        .trim()
        .min(1)
        .describe('Table name, optionally schema-qualified ("sales.orders").'),
});

const REL = `(select c.oid from pg_class as c join pg_namespace as n on n.oid = c.relnamespace where n.nspname = @schema and c.relname = @table and c.relkind in ('r', 'p', 'v', 'm', 'f'))`;

const COLUMNS_SQL = `
select
    a.attname as "name",
    format_type(a.atttypid, a.atttypmod) as "type",
    not a.attnotnull as "nullable",
    a.attidentity <> '' as "identity",
    a.attgenerated <> '' as "computed",
    pg_get_expr(d.adbin, d.adrelid) as "default",
    col_description(a.attrelid, a.attnum) as "comment"
from pg_attribute as a
    left join pg_attrdef as d on d.adrelid = a.attrelid and d.adnum = a.attnum
where a.attrelid = ${REL} and a.attnum > 0 and not a.attisdropped
order by a.attnum`;

const INDEXES_SQL = `
select
    ic.relname as "name",
    am.amname as "type",
    i.indisprimary as "is_primary_key",
    i.indisunique as "is_unique",
    pg_get_expr(i.indpred, i.indrelid) as "filter",
    pg_get_indexdef(i.indexrelid) as "definition",
    pg_size_pretty(pg_relation_size(i.indexrelid)) as "size"
from pg_index as i
    join pg_class as ic on ic.oid = i.indexrelid
    join pg_am as am on am.oid = ic.relam
where i.indrelid = ${REL}
order by i.indisprimary desc, ic.relname`;

const FOREIGN_KEYS_SQL = `
select
    con.conname as "name",
    case when con.conrelid = ${REL} then 'outgoing' else 'incoming' end as "direction",
    fn.nspname || '.' || fc.relname as "fromTable",
    (select string_agg(a.attname, ', ' order by k.ord)
        from unnest(con.conkey) with ordinality as k(attnum, ord)
        join pg_attribute as a on a.attrelid = con.conrelid and a.attnum = k.attnum) as "fromColumns",
    tn.nspname || '.' || tc.relname as "toTable",
    (select string_agg(a.attname, ', ' order by k.ord)
        from unnest(con.confkey) with ordinality as k(attnum, ord)
        join pg_attribute as a on a.attrelid = con.confrelid and a.attnum = k.attnum) as "toColumns",
    case con.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as "onDelete",
    case con.confupdtype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as "onUpdate"
from pg_constraint as con
    join pg_class as fc on fc.oid = con.conrelid
    join pg_namespace as fn on fn.oid = fc.relnamespace
    join pg_class as tc on tc.oid = con.confrelid
    join pg_namespace as tn on tn.oid = tc.relnamespace
where con.contype = 'f' and (con.conrelid = ${REL} or con.confrelid = ${REL})
order by "direction", con.conname`;

export const describeTableTool: ToolDefinition<typeof inputSchema> = {
    name: 'describe_table',
    title: 'Describe table',
    description:
        'Returns the columns (type, nullability, identity, generated flag, default, comment), indexes (with definition and size) and foreign keys (both directions) of a table or view.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const { object, params } = objectParams(context.dialect, args.table, args.schema);
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
