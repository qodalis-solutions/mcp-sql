import { z } from 'zod';
import {
    databaseArg,
    firstRow,
    objectParams,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    schemaArg,
    ToolInputError,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

const inputSchema = z.object({
    database: databaseArg,
    name: z
        .string()
        .trim()
        .min(1)
        .describe(
            'View, materialized view, function, procedure or trigger name, optionally schema-qualified.',
        ),
    schema: schemaArg,
});

const SQL = `
select * from (
    select
        case c.relkind when 'm' then 'materialized view' else 'view' end as "type",
        pg_get_viewdef(c.oid, true) as "definition"
    from pg_class as c
        join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = @schema and c.relname = @table and c.relkind in ('v', 'm')
    union all
    select
        case p.prokind when 'p' then 'procedure' else 'function' end as "type",
        pg_get_functiondef(p.oid) as "definition"
    from pg_proc as p
        join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = @schema and p.proname = @table and p.prokind in ('f', 'p', 'w')
    union all
    select
        'trigger' as "type",
        pg_get_triggerdef(t.oid, true) as "definition"
    from pg_trigger as t
        join pg_class as c on c.oid = t.tgrelid
        join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = @schema and t.tgname = @table and not t.tgisinternal
) as defs
limit 1`;

export const getObjectDefinitionTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_object_definition',
    title: 'Get object definition',
    description:
        'Returns the SQL source of a view, materialized view, function, procedure or trigger.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const { object, params } = objectParams(context.dialect, args.name, args.schema);
        const row = firstRow(
            await context.executor.run({ database, params, signal: context.signal, sql: SQL }),
        );
        const definition = row?.definition;
        if (typeof definition !== 'string') {
            throw new ToolInputError(
                `Object ${object.schema}.${object.name} was not found as a view, function, procedure or trigger; use describe_table for tables.`,
            );
        }
        const header = `-- ${String(row?.type)} ${object.schema}.${object.name}\n`;
        return {
            text: header + definition,
            structured: { name: `${object.schema}.${object.name}`, type: row?.type, definition },
        };
    },
};
