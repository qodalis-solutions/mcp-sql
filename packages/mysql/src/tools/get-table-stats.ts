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
    table_schema as \`schema\`,
    table_name as \`table\`,
    engine as engine,
    table_rows as rowCount,
    round((data_length + index_length) / 1024) as totalKb,
    round(data_length / 1024) as dataKb,
    round(index_length / 1024) as indexKb,
    round(data_free / 1024) as freeKb,
    auto_increment as autoIncrement,
    create_time as createTime,
    update_time as updateTime
from information_schema.tables
where
    table_type = 'BASE TABLE' and
    table_schema = coalesce(@schema, database())${scoped ? ' and\n    table_name = @table' : ''}
order by data_length + index_length desc${scoped ? '' : '\nlimit @top'}`;

export const getTableStatsTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_table_stats',
    title: 'Get table statistics',
    description:
        'Row estimate, data/index/free size in KB, next auto-increment value and timestamps, for one table or the largest tables in a database.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const scope = resolveScope(context, args);
        const scoped = args.table !== undefined;
        const params = scoped
            ? scopedObject(context.dialect, args.table ?? '', scope).params
            : { schema: scope.schema, top: args.top };
        const result = await context.executor.run({
            database: scope.database,
            params,
            signal: context.signal,
            sql: buildSql(scoped),
        });
        return resultOutput(result);
    },
};
