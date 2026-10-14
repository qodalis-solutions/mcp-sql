import { z } from 'zod';
import {
    databaseArg,
    READ_ONLY_ANNOTATIONS,
    resultOutput,
    schemaArg,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';
import { resolveScope, scopedObject } from './scope.js';

const inputSchema = z.object({
    database: databaseArg,
    schema: schemaArg.describe('Database to inspect; defaults to the current database.'),
    table: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
            'Limit to relationships touching this table (either side). Omit for the whole database.',
        ),
});

const buildSql = (scoped: boolean): string => `
select
    k.constraint_name as name,
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
    k.referenced_table_name is not null and${
        scoped
            ? `
    ((k.table_schema = coalesce(@schema, database()) and k.table_name = @table) or
     (k.referenced_table_schema = coalesce(@schema, database()) and k.referenced_table_name = @table))`
            : `
    k.table_schema = coalesce(@schema, database())`
    }
group by k.constraint_name, k.table_schema, k.table_name, k.referenced_table_schema, k.referenced_table_name
order by fromTable, k.constraint_name`;

export const getForeignKeysTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_foreign_keys',
    title: 'Get foreign keys',
    description:
        'Lists foreign key relationships with their columns and referential actions, for one table (both directions) or a whole database.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const scope = resolveScope(context, args);
        const scoped = args.table !== undefined;
        const params = scoped
            ? scopedObject(context.dialect, args.table ?? '', scope).params
            : { schema: scope.schema };
        const result = await context.executor.run({
            database: scope.database,
            params,
            signal: context.signal,
            sql: buildSql(scoped),
        });
        return resultOutput(result);
    },
};
