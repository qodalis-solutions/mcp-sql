import { z } from 'zod';
import {
    databaseArg,
    jsonOutput,
    READ_ONLY_ANNOTATIONS,
    rowsToObjects,
    schemaArg,
    ToolInputError,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';
import { displayName, resolveScope, scopedObject } from './scope.js';

const inputSchema = z.object({
    database: databaseArg,
    schema: schemaArg.describe('Database of the table; defaults to the current database.'),
    table: z
        .string()
        .trim()
        .min(1)
        .describe('Table name, optionally database-qualified ("shop.orders").'),
});

const SCOPE = 'table_schema = coalesce(@schema, database()) and table_name = @table';

const COLUMNS_SQL = `
select
    column_name as name,
    column_type as type,
    is_nullable = 'YES' as nullable,
    extra like '%auto_increment%' as \`identity\`,
    extra like '%GENERATED%' as computed,
    column_default as \`default\`,
    column_key as \`key\`,
    character_set_name as characterSet,
    collation_name as collation,
    column_comment as comment
from information_schema.columns
where ${SCOPE}
order by ordinal_position`;

const INDEXES_SQL = `
select
    index_name as name,
    index_type as type,
    index_name = 'PRIMARY' as is_primary_key,
    non_unique = 0 as is_unique,
    group_concat(column_name order by seq_in_index separator ', ') as \`columns\`,
    max(index_comment) as comment
from information_schema.statistics
where ${SCOPE}
group by index_name, index_type, non_unique
order by is_primary_key desc, index_name`;

const FOREIGN_KEYS_SQL = `
select
    k.constraint_name as name,
    case when k.table_schema = coalesce(@schema, database()) and k.table_name = @table then 'outgoing' else 'incoming' end as direction,
    concat(k.table_schema, '.', k.table_name) as fromTable,
    group_concat(k.column_name order by k.ordinal_position separator ', ') as fromColumns,
    concat(k.referenced_table_schema, '.', k.referenced_table_name) as toTable,
    group_concat(k.referenced_column_name order by k.ordinal_position separator ', ') as toColumns,
    max(r.delete_rule) as onDelete,
    max(r.update_rule) as onUpdate
from information_schema.key_column_usage as k
    join information_schema.referential_constraints as r
        on r.constraint_schema = k.constraint_schema and r.constraint_name = k.constraint_name
where
    k.referenced_table_name is not null and
    ((k.table_schema = coalesce(@schema, database()) and k.table_name = @table) or
     (k.referenced_table_schema = coalesce(@schema, database()) and k.referenced_table_name = @table))
group by k.constraint_name, k.table_schema, k.table_name, k.referenced_table_schema, k.referenced_table_name
order by direction, k.constraint_name`;

export const describeTableTool: ToolDefinition<typeof inputSchema> = {
    name: 'describe_table',
    title: 'Describe table',
    description:
        'Returns the columns (full type, nullability, auto-increment, generated flag, default, key, comment), indexes (with columns) and foreign keys (both directions) of a table or view.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const scope = resolveScope(context, args);
        const { object, params } = scopedObject(context.dialect, args.table, scope);
        const run = (sql: string) =>
            context.executor.run({ database: scope.database, params, signal: context.signal, sql });

        const columns = rowsToObjects(await run(COLUMNS_SQL));
        if (columns.length === 0) {
            throw new ToolInputError(
                `Table ${displayName(object)} was not found in ${scope.database ?? 'the current database'}.`,
            );
        }
        const [indexes, foreignKeys] = await Promise.all([run(INDEXES_SQL), run(FOREIGN_KEYS_SQL)]);

        return jsonOutput({
            table: displayName(object),
            columns,
            indexes: rowsToObjects(indexes),
            foreignKeys: rowsToObjects(foreignKeys),
        });
    },
};
