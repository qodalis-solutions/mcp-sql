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
        .describe('A single table to measure. Omit to list the largest tables of the schema.'),
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
    t.owner as "schema",
    t.table_name as "table",
    t.num_rows as "rowCount",
    t.blocks as "blocks",
    t.avg_row_len as "avgRowLength",
    case when t.owner = user then
        (select round(sum(s.bytes) / 1024) from user_segments s where s.segment_name = t.table_name and s.segment_type like 'TABLE%')
    end as "dataKb",
    (select count(*) from all_indexes i where i.table_owner = t.owner and i.table_name = t.table_name) as "indexCount",
    t.last_analyzed as "lastAnalyzed"
from all_tables t
where t.owner = @schema${scoped ? ' and t.table_name = @table' : " and t.nested = 'NO' and t.table_name not like 'BIN$%'"}
order by t.num_rows desc nulls last, t.table_name${scoped ? '' : '\nfetch first @top rows only'}`;

export const getTableStatsTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_table_stats',
    title: 'Get table statistics',
    description:
        'Optimizer row estimate, blocks, average row length, segment size (own schema only), index count and last statistics time, for one table or the largest tables of a schema.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const { database, schema } = resolveSchema(context, args.schema, args.database);
        const scoped = args.table !== undefined;
        const params = scoped
            ? objectParams(context.dialect, args.table ?? '', schema).params
            : { schema, top: args.top };
        const result = await context.executor.run({
            database,
            params,
            signal: context.signal,
            sql: buildSql(scoped),
        });
        return resultOutput(result);
    },
};
