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
    kind: z
        .enum(['all', 'function', 'procedure'])
        .default('all')
        .describe('Restrict to procedures or functions.'),
    nameContains: nameContainsArg,
    schema: schemaArg.describe('Database to list; defaults to the current database.'),
});

const SQL = `
select
    r.routine_schema as \`schema\`,
    r.routine_name as name,
    lower(r.routine_type) as kind,
    r.dtd_identifier as \`returns\`,
    (select group_concat(concat(p.parameter_mode, ' ', p.parameter_name, ' ', p.dtd_identifier) order by p.ordinal_position separator ', ')
        from information_schema.parameters as p
        where p.specific_schema = r.routine_schema and p.specific_name = r.specific_name and p.ordinal_position > 0) as arguments,
    r.is_deterministic as isDeterministic,
    r.sql_data_access as dataAccess,
    r.definer as definer,
    r.routine_comment as comment
from information_schema.routines as r
where
    (@kind = 'ALL' or r.routine_type = @kind) and
    r.routine_schema = coalesce(@schema, database()) and
    (@namePattern is null or r.routine_name like @namePattern)
order by r.routine_name`;

export const listProceduresTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_procedures',
    title: 'List procedures and functions',
    description:
        'Lists stored procedures and functions with arguments, return type and data access. Use get_object_definition for the body.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const scope = resolveScope(context, args);
        const result = await context.executor.run({
            database: scope.database,
            params: {
                kind: args.kind.toUpperCase(),
                schema: scope.schema,
                namePattern: likePattern(args.nameContains, context.dialect.likeEscape),
            },
            signal: context.signal,
            sql: SQL,
        });
        return resultOutput(result);
    },
};
