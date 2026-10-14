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
        .describe('Table or view name, optionally schema-qualified ("main.orders", "temp.tmp").'),
});

const COLUMNS_SQL = `
select
    name as "name",
    case when type = '' then null else type end as "type",
    "notnull" = 0 as "nullable",
    pk as "primaryKeyPosition",
    dflt_value as "default",
    case hidden when 2 then 'virtual' when 3 then 'stored' else null end as "generated",
    hidden = 1 as "hidden"
from pragma_table_xinfo(@table, @schema)
order by cid`;

const INDEXES_SQL = `
select
    il.name as "name",
    il."unique" = 1 as "is_unique",
    il.origin = 'pk' as "is_primary_key",
    il.origin as "origin",
    il.partial = 1 as "is_partial",
    (select group_concat(ii.name, ', ') from (select name from pragma_index_info(il.name, @schema) order by seqno) as ii) as "columns"
from pragma_index_list(@table, @schema) as il
order by il.seq`;

const FOREIGN_KEYS_SQL = `
select
    'fk_' || fk.id as "name",
    'outgoing' as "direction",
    @schema || '.' || @table as "fromTable",
    group_concat(fk."from", ', ') as "fromColumns",
    fk."table" as "toTable",
    group_concat(fk."to", ', ') as "toColumns",
    fk.on_update as "onUpdate",
    fk.on_delete as "onDelete"
from pragma_foreign_key_list(@table, @schema) as fk
group by fk.id
union all
select
    'fk_' || fk.id as "name",
    'incoming' as "direction",
    m.schema || '.' || m.name as "fromTable",
    group_concat(fk."from", ', ') as "fromColumns",
    fk."table" as "toTable",
    group_concat(fk."to", ', ') as "toColumns",
    fk.on_update as "onUpdate",
    fk.on_delete as "onDelete"
from pragma_table_list as m
    join pragma_foreign_key_list(m.name, m.schema) as fk
where m.type = 'table' and m.schema = @schema and fk."table" = @table
group by m.schema, m.name, fk.id
order by "direction" desc, "fromTable", "name"`;

/** SQLite has no boolean type: the pragma flags come back as 0/1 and are mapped here. */
const BOOLEAN_FIELDS = new Set(['hidden', 'is_partial', 'is_primary_key', 'is_unique', 'nullable']);

const withBooleans = (rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
    rows.map((row) =>
        Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
                key,
                BOOLEAN_FIELDS.has(key) && (value === 0 || value === 1) ? value === 1 : value,
            ]),
        ),
    );

export const describeTableTool: ToolDefinition<typeof inputSchema> = {
    name: 'describe_table',
    title: 'Describe table',
    description:
        'Returns the columns (declared type, nullability, primary key position, default, generated flag), indexes (columns, unique, partial, origin) and foreign keys (both directions) of a table or view.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const { object, params } = objectParams(context.dialect, args.table, args.schema);
        const run = (sql: string) =>
            context.executor.run({ database, params, signal: context.signal, sql });

        const columns = withBooleans(rowsToObjects(await run(COLUMNS_SQL)));
        if (columns.length === 0) {
            throw new ToolInputError(
                `Table ${object.schema}.${object.name} was not found in ${database ?? 'the current database'}.`,
            );
        }
        const [indexes, foreignKeys] = await Promise.all([run(INDEXES_SQL), run(FOREIGN_KEYS_SQL)]);

        return jsonOutput({
            table: `${object.schema}.${object.name}`,
            columns,
            indexes: withBooleans(rowsToObjects(indexes)),
            foreignKeys: rowsToObjects(foreignKeys),
        });
    },
};
