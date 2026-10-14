import { z } from 'zod';
import {
    databaseArg,
    firstRow,
    objectParams,
    READ_ONLY_ANNOTATIONS,
    rowsToObjects,
    schemaArg,
    ToolInputError,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';
import { resolveSchema } from './shared.js';

const inputSchema = z.object({
    database: databaseArg,
    name: z
        .string()
        .trim()
        .min(1)
        .describe(
            'View, materialized view, procedure, function, package, trigger or type name, optionally schema-qualified.',
        ),
    schema: schemaArg,
});

const TYPE_SQL = `
select o.object_type as "type"
from all_objects o
where o.owner = @schema and o.object_name = @table and o.object_type in
    ('VIEW', 'MATERIALIZED VIEW', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'TRIGGER', 'TYPE')
order by case o.object_type when 'MATERIALIZED VIEW' then 0 else 1 end
fetch first 1 rows only`;

const VIEW_SQL = `select v.text_vc as "definition" from all_views v where v.owner = @schema and v.view_name = @table`;

const MVIEW_SQL = `select m.query as "definition" from all_mviews m where m.owner = @schema and m.mview_name = @table`;

const SOURCE_SQL = `
select s.type as "type", s.line as "line", s.text as "text"
from all_source s
where s.owner = @schema and s.name = @table and s.type in (@type, @bodyType)
order by case s.type when @type then 0 else 1 end, s.line`;

export const getObjectDefinitionTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_object_definition',
    title: 'Get object definition',
    description:
        'Returns the source of a view, materialized view, procedure, function, package (spec and body), trigger or type.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const { database, schema } = resolveSchema(context, args.schema, args.database);
        const { object, params } = objectParams(context.dialect, args.name, schema);
        const run = (sql: string, extra: Record<string, string> = {}) =>
            context.executor.run({
                database,
                params: { ...params, ...extra },
                signal: context.signal,
                sql,
            });

        const type = firstRow(await run(TYPE_SQL))?.type;
        if (typeof type !== 'string') {
            throw new ToolInputError(
                `Object ${object.schema}.${object.name} was not found as a view, procedure, function, package, trigger or type; use describe_table for tables.`,
            );
        }
        const qualified = `${object.schema}.${object.name}`;
        const header = `-- ${type.toLowerCase()} ${qualified}\n`;
        let definition: string;
        if (type === 'VIEW' || type === 'MATERIALIZED VIEW') {
            const row = firstRow(await run(type === 'VIEW' ? VIEW_SQL : MVIEW_SQL));
            definition = String(row?.definition ?? '');
        } else {
            const bodyType =
                type === 'PACKAGE' ? 'PACKAGE BODY' : type === 'TYPE' ? 'TYPE BODY' : type;
            const lines = rowsToObjects(await run(SOURCE_SQL, { type, bodyType }));
            let current = '';
            const chunks: string[] = [];
            for (const line of lines) {
                if (line.type !== current) {
                    current = String(line.type);
                    chunks.push(`-- ${current.toLowerCase()}\n`);
                }
                chunks.push(String(line.text));
            }
            definition = chunks.join('');
        }
        return {
            text: header + definition,
            structured: { name: qualified, type: type.toLowerCase(), definition },
        };
    },
};
