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
import { resolveScope } from './scope.js';

const inputSchema = z.object({
    database: databaseArg,
    includeRowCounts: z
        .boolean()
        .default(true)
        .describe('Include the storage engine row estimate per table. Default true.'),
    nameContains: nameContainsArg,
    schema: schemaArg.describe('Database to list; defaults to the current database.'),
});

const buildSql = (includeRowCounts: boolean): string => `
select
    table_schema as \`schema\`,
    table_name as name,
    engine as engine,${includeRowCounts ? '\n    table_rows as rowCount,' : ''}
    data_length + index_length as sizeBytes,
    table_comment as comment,
    create_time as createTime,
    update_time as updateTime
from information_schema.tables
where
    table_type = 'BASE TABLE' and
    table_schema = coalesce(@schema, database()) and
    (@namePattern is null or table_name like @namePattern)
order by table_name`;

export const listTablesTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_tables',
    title: 'List tables',
    description:
        'Lists base tables in a database with engine, estimated row count, size and comment. Filter by name substring. Defaults to the current database.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const scope = resolveScope(context, args);
        const result = await context.executor.run({
            database: scope.database,
            params: {
                schema: scope.schema,
                namePattern: likePattern(args.nameContains, context.dialect.likeEscape),
            },
            signal: context.signal,
            sql: buildSql(args.includeRowCounts),
        });
        return resultOutput(result);
    },
};
