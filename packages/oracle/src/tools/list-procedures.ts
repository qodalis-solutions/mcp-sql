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
    kind: z
        .enum(['all', 'function', 'package', 'procedure'])
        .default('all')
        .describe('Restrict to one kind of routine.'),
    nameContains: nameContainsArg,
    schema: schemaArg,
});

const SQL = `
select
    o.owner as "schema",
    o.object_name as "name",
    lower(o.object_type) as "kind",
    o.status as "status",
    o.created as "created",
    o.last_ddl_time as "lastModified"
from all_objects o
where
    o.owner = @schema and
    o.object_type in ('PROCEDURE', 'FUNCTION', 'PACKAGE') and
    (@kind = 'all' or o.object_type = upper(@kind)) and
    (@namePattern is null or upper(o.object_name) like upper(@namePattern) escape '\\')
order by o.object_type, o.object_name`;

export const listProceduresTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_procedures',
    title: 'List procedures, functions and packages',
    description:
        'Lists stand-alone procedures and functions and packages of a schema with their validity status. Use get_object_definition for the source and signature.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const { database, schema } = resolveSchema(context, args.schema, args.database);
        const result = await context.executor.run({
            database,
            params: {
                kind: args.kind,
                schema,
                namePattern: likePattern(args.nameContains, context.dialect.likeEscape),
            },
            signal: context.signal,
            sql: SQL,
        });
        return resultOutput(result);
    },
};
