import { z } from 'zod';
import { resolveDatabase, type ToolDefinition } from './context.js';
import {
    databaseArg,
    objectParams,
    READ_ONLY_ANNOTATIONS,
    resultOutput,
    schemaArg,
} from './shared.js';

const inputSchema = z.object({
    database: databaseArg,
    schema: schemaArg,
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
select ${scoped ? '' : 'top (@top)'}
    schema_name([t].[schema_id]) as [schema],
    [t].[name] as [table],
    [r].[rowCount],
    sum([au].[total_pages]) * 8 as [reservedKb],
    sum(case when [p].[index_id] in (0, 1) then [au].[used_pages] else 0 end) * 8 as [dataKb],
    sum(case when [p].[index_id] > 1 then [au].[used_pages] else 0 end) * 8 as [indexKb],
    sum([au].[total_pages] - [au].[used_pages]) * 8 as [unusedKb],
    [r].[indexCount],
    [r].[partitionCount]
from sys.tables as [t]
    join sys.partitions as [p] on [p].[object_id] = [t].[object_id]
    join sys.allocation_units as [au] on
        ([au].[type] in (1, 3) and [au].[container_id] = [p].[hobt_id]) or
        ([au].[type] = 2 and [au].[container_id] = [p].[partition_id])
    outer apply (
        select
            sum(case when [rp].[index_id] in (0, 1) then [rp].[rows] else 0 end) as [rowCount],
            count(distinct case when [rp].[index_id] > 0 then [rp].[index_id] end) as [indexCount],
            count(distinct [rp].[partition_number]) as [partitionCount]
        from sys.partitions as [rp]
        where [rp].[object_id] = [t].[object_id]
    ) as [r]
${scoped ? `where [t].[object_id] = object_id(quotename(@schema) + '.' + quotename(@table), 'U')` : ''}
group by [t].[schema_id], [t].[name], [r].[rowCount], [r].[indexCount], [r].[partitionCount]
order by [reservedKb] desc`;

export const getTableStatsTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_table_stats',
    title: 'Get table statistics',
    description:
        'Row count, reserved/data/index/unused size in KB, index and partition counts, for one table or the largest tables. Uses sys.partitions and sys.allocation_units, so no VIEW DATABASE STATE permission is needed.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const scoped = args.table !== undefined;
        const params = scoped
            ? objectParams(args.table ?? '', args.schema).params
            : { top: args.top };
        const result = await context.executor.run({
            database,
            params,
            signal: context.signal,
            sql: buildSql(scoped),
        });
        return resultOutput(result);
    },
};
