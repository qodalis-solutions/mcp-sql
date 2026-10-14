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
    nameContains: nameContainsArg,
    schema: schemaArg.describe('Database to list; defaults to the current database.'),
});

const SQL = `
select
    t.table_schema as \`schema\`,
    t.table_name as name,
    v.definer as definer,
    v.is_updatable as isUpdatable,
    v.security_type as securityType
from information_schema.tables as t
    left join information_schema.views as v on v.table_schema = t.table_schema and v.table_name = t.table_name
where
    t.table_type = 'VIEW' and
    t.table_schema = coalesce(@schema, database()) and
    (@namePattern is null or t.table_name like @namePattern)
order by t.table_name`;

export const listViewsTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_views',
    title: 'List views',
    description:
        'Lists views in a database. Filter by name substring. Use get_object_definition for the SQL.',
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
            sql: SQL,
        });
        return resultOutput(result);
    },
};
