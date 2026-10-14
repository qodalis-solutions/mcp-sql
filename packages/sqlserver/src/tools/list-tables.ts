import { z } from 'zod';
import {
    databaseArg,
    likePattern,
    nameContainsArg,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    resultOutput,
    schemaArg,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

const inputSchema = z.object({
    database: databaseArg,
    includeRowCounts: z
        .boolean()
        .default(true)
        .describe(
            'Include an approximate row count per table (from partition statistics). Default true.',
        ),
    nameContains: nameContainsArg,
    schema: schemaArg,
});

const buildSql = (includeRowCounts: boolean): string => `
select
    [s].[name] as [schema],
    [t].[name] as [name],${includeRowCounts ? '\n    [p].[rowCount] as [rowCount],' : ''}
    [t].[create_date] as [createDate],
    [t].[modify_date] as [modifyDate]
from sys.tables as [t]
    join sys.schemas as [s] on [s].[schema_id] = [t].[schema_id]${
        includeRowCounts
            ? `
    outer apply (
        select sum([p].[rows]) as [rowCount]
        from sys.partitions as [p]
        where [p].[object_id] = [t].[object_id] and [p].[index_id] in (0, 1)
    ) as [p]`
            : ''
    }
where
    [t].[is_ms_shipped] = 0 and
    (@schema is null or [s].[name] = @schema) and
    (@namePattern is null or [t].[name] like @namePattern)
order by [s].[name], [t].[name]`;

export const listTablesTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_tables',
    title: 'List tables',
    description:
        'Lists user tables with schema, approximate row count and timestamps. Filter by schema or name substring.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({
            database,
            params: {
                schema: args.schema ?? null,
                namePattern: likePattern(args.nameContains, context.dialect.likeEscape),
            },
            signal: context.signal,
            sql: buildSql(args.includeRowCounts),
        });
        return resultOutput(result);
    },
};
