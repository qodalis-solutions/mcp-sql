import { z } from 'zod';
import {
    databaseArg,
    jsonOutput,
    objectParams,
    READ_ONLY_ANNOTATIONS,
    rowsToObjects,
    schemaArg,
    ToolInputError,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';
import { resolveSchema } from './shared.js';

const inputSchema = z.object({
    database: databaseArg,
    schema: schemaArg,
    table: z
        .string()
        .trim()
        .min(1)
        .describe(
            'Table or view name, optionally schema-qualified ("HR.EMPLOYEES"). Unquoted names are upper-cased.',
        ),
});

const COLUMNS_SQL = `
select
    c.column_name as "name",
    case
        when c.data_type in ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR') then c.data_type || '(' || c.char_length || ')'
        when c.data_type = 'RAW' then c.data_type || '(' || c.data_length || ')'
        when c.data_type = 'NUMBER' and c.data_precision is not null then
            'NUMBER(' || c.data_precision || case when c.data_scale > 0 then ',' || c.data_scale else '' end || ')'
        else c.data_type
    end as "type",
    case c.nullable when 'Y' then 1 else 0 end as "nullable",
    case c.identity_column when 'YES' then 1 else 0 end as "identity",
    case c.virtual_column when 'YES' then 1 else 0 end as "computed",
    c.data_default as "default",
    cc.comments as "comment"
from all_tab_cols c
    left join all_col_comments cc on cc.owner = c.owner and cc.table_name = c.table_name and cc.column_name = c.column_name
where c.owner = @schema and c.table_name = @table and c.hidden_column = 'NO' and c.user_generated = 'YES'
order by c.column_id`;

const INDEXES_SQL = `
select
    i.index_name as "name",
    lower(i.index_type) as "type",
    case when exists (
        select 1 from all_constraints k
        where k.owner = i.table_owner and k.table_name = i.table_name and k.constraint_type = 'P' and k.index_name = i.index_name
    ) then 1 else 0 end as "is_primary_key",
    case i.uniqueness when 'UNIQUE' then 1 else 0 end as "is_unique",
    (select listagg(ic.column_name, ', ') within group (order by ic.column_position)
        from all_ind_columns ic where ic.index_owner = i.owner and ic.index_name = i.index_name) as "columns",
    i.status as "status",
    i.last_analyzed as "lastAnalyzed"
from all_indexes i
where i.table_owner = @schema and i.table_name = @table
order by "is_primary_key" desc, i.index_name`;

export const FOREIGN_KEYS_SQL = `
select
    c.constraint_name as "name",
    case when c.owner = @schema and c.table_name = @table then 'outgoing' else 'incoming' end as "direction",
    c.owner || '.' || c.table_name as "fromTable",
    (select listagg(cc.column_name, ', ') within group (order by cc.position)
        from all_cons_columns cc where cc.owner = c.owner and cc.constraint_name = c.constraint_name) as "fromColumns",
    r.owner || '.' || r.table_name as "toTable",
    (select listagg(rc.column_name, ', ') within group (order by rc.position)
        from all_cons_columns rc where rc.owner = r.owner and rc.constraint_name = r.constraint_name) as "toColumns",
    c.delete_rule as "onDelete",
    c.status as "status"
from all_constraints c
    join all_constraints r on r.owner = c.r_owner and r.constraint_name = c.r_constraint_name
where c.constraint_type = 'R' and ((c.owner = @schema and c.table_name = @table) or (r.owner = @schema and r.table_name = @table))
order by "direction", c.constraint_name`;

export const describeTableTool: ToolDefinition<typeof inputSchema> = {
    name: 'describe_table',
    title: 'Describe table',
    description:
        'Returns the columns (type, nullability, identity, virtual flag, default, comment), indexes (type, columns, uniqueness) and foreign keys (both directions) of a table or view.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const { database, schema } = resolveSchema(context, args.schema, args.database);
        const { object, params } = objectParams(context.dialect, args.table, schema);
        const run = (sql: string) =>
            context.executor.run({ database, params, signal: context.signal, sql });

        const columns = rowsToObjects(await run(COLUMNS_SQL));
        if (columns.length === 0) {
            throw new ToolInputError(
                `Table ${object.schema}.${object.name} was not found (names are case-sensitive; unquoted names are upper-cased).`,
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
