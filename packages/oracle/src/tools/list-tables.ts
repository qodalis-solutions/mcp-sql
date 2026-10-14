import { z } from 'zod';
import {
    databaseArg,
    likePattern,
    nameContainsArg,
    READ_ONLY_ANNOTATIONS,
    resultOutput,
    schemaArg,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';
import { resolveSchema } from './shared.js';

const inputSchema = z.object({
    database: databaseArg,
    includeRowCounts: z
        .boolean()
        .default(true)
        .describe(
            'Include the optimizer row estimate (num_rows from the last statistics gathering). Default true.',
        ),
    nameContains: nameContainsArg,
    schema: schemaArg,
});

const buildSql = (includeRowCounts: boolean): string => `
select
    t.owner as "schema",
    t.table_name as "name",
    case when t.temporary = 'Y' then 'global temporary' when t.partitioned = 'YES' then 'partitioned' else 'table' end as "kind",${
        includeRowCounts ? '\n    t.num_rows as "rowCount",' : ''
    }
    t.last_analyzed as "lastAnalyzed",
    c.comments as "comment"
from all_tables t
    left join all_tab_comments c on c.owner = t.owner and c.table_name = t.table_name
where
    t.owner = @schema and
    t.nested = 'NO' and
    t.table_name not like 'BIN$%' and
    (@namePattern is null or upper(t.table_name) like upper(@namePattern) escape '\\')
order by t.table_name`;

export const listTablesTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_tables',
    title: 'List tables',
    description:
        'Lists the tables of a schema (the configured schema by default) with row estimates, last statistics time and comment. Filter by name substring.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const { database, schema } = resolveSchema(context, args.schema, args.database);
        const result = await context.executor.run({
            database,
            params: {
                schema,
                namePattern: likePattern(args.nameContains, context.dialect.likeEscape),
            },
            signal: context.signal,
            sql: buildSql(args.includeRowCounts),
        });
        return resultOutput(result);
    },
};
