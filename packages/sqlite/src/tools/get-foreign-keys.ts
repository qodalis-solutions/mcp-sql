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

const buildSql = (scoped: boolean): string => `
select
    m.schema || '.' || m.name as "fromTable",
    'fk_' || fk.id as "name",
    group_concat(fk."from", ', ') as "fromColumns",
    fk."table" as "toTable",
    group_concat(fk."to", ', ') as "toColumns",
    fk.on_update as "onUpdate",
    fk.on_delete as "onDelete"
from pragma_table_list as m
    join pragma_foreign_key_list(m.name, m.schema) as fk
where
    m.type = 'table' and
    m.name not like 'sqlite\\_%' escape '\\'${scoped ? ' and\n    m.schema = @schema and (m.name = @table or fk."table" = @table)' : ''}
group by m.schema, m.name, fk.id
order by "fromTable", "name"`;

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
