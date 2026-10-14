import { z } from 'zod';
import {
    databaseArg,
    firstRow,
    READ_ONLY_ANNOTATIONS,
    schemaArg,
    ToolInputError,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';
import { displayName, resolveScope, scopedObject } from './scope.js';

const inputSchema = z.object({
    database: databaseArg,
    name: z
        .string()
        .trim()
        .min(1)
        .describe('View, procedure, function or trigger name, optionally database-qualified.'),
    schema: schemaArg.describe('Database of the object; defaults to the current database.'),
});

const SQL = `
select * from (
    select 'view' as type, view_definition as definition
    from information_schema.views
    where table_schema = coalesce(@schema, database()) and table_name = @table
    union all
    select lower(routine_type) as type, routine_definition as definition
    from information_schema.routines
    where routine_schema = coalesce(@schema, database()) and routine_name = @table
    union all
    select 'trigger' as type, action_statement as definition
    from information_schema.triggers
    where trigger_schema = coalesce(@schema, database()) and trigger_name = @table
) as defs
limit 1`;

export const getObjectDefinitionTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_object_definition',
    title: 'Get object definition',
    description: 'Returns the SQL source of a view, stored procedure, function or trigger.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const scope = resolveScope(context, args);
        const { object, params } = scopedObject(context.dialect, args.name, scope);
        const row = firstRow(
            await context.executor.run({
                database: scope.database,
                params,
                signal: context.signal,
                sql: SQL,
            }),
        );
        if (!row) {
            throw new ToolInputError(
                `Object ${displayName(object)} was not found as a view, procedure, function or trigger; use describe_table for tables.`,
            );
        }
        const definition = row.definition;
        if (typeof definition !== 'string' || definition.length === 0) {
            throw new ToolInputError(
                `The definition of ${String(row.type)} ${displayName(object)} is hidden from this login: MySQL requires SHOW VIEW on views and ownership (or the SELECT privilege on mysql.proc / SHOW_ROUTINE) on routines to read the source.`,
            );
        }
        const header = `-- ${String(row.type)} ${displayName(object)}\n`;
        return {
            text: header + definition,
            structured: { name: displayName(object), type: row.type, definition },
        };
    },
};
