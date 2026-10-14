import { z } from 'zod';
import {
    databaseArg,
    objectParams,
    READ_ONLY_ANNOTATIONS,
    resultOutput,
    schemaArg,
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
        .optional()
        .describe(
            'Limit to relationships touching this table (either side). Omit for the whole schema.',
        ),
});

const buildSql = (scoped: boolean): string => `
select
    c.constraint_name as "name",
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
where c.constraint_type = 'R' and ${
    scoped
        ? '((c.owner = @schema and c.table_name = @table) or (r.owner = @schema and r.table_name = @table))'
        : 'c.owner = @schema'
}
order by "fromTable", c.constraint_name`;

export const getForeignKeysTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_foreign_keys',
    title: 'Get foreign keys',
    description:
        'Lists foreign key relationships with their columns and delete rule, for one table (both directions) or a whole schema.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const { database, schema } = resolveSchema(context, args.schema, args.database);
        const scoped = args.table !== undefined;
        const params = scoped
            ? objectParams(context.dialect, args.table ?? '', schema).params
            : { schema };
        const result = await context.executor.run({
            database,
            params,
            signal: context.signal,
            sql: buildSql(scoped),
        });
        return resultOutput(result);
    },
};
