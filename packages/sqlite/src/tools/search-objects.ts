import { z } from 'zod';
import {
    databaseArg,
    likePattern,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    resultOutput,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

const OBJECT_TYPES = ['column', 'index', 'table', 'trigger', 'view'] as const;

const inputSchema = z.object({
    database: databaseArg,
    limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(100)
        .describe('Maximum number of matches to return.'),
    pattern: z
        .string()
        .trim()
        .min(1)
        .describe('Case-insensitive substring to look for in object and column names.'),
    types: z
        .array(z.enum(OBJECT_TYPES))
        .min(1)
        .default([...OBJECT_TYPES])
        .describe('Which kinds of objects to search. Defaults to all.'),
});

const NOT_INTERNAL = "name not like 'sqlite\\_%' escape '\\'";

const buildSql = (types: ReadonlyArray<(typeof OBJECT_TYPES)[number]>): string => {
    const parts: string[] = [];
    const relations = types.filter((t) => t === 'table' || t === 'view');
    if (relations.length > 0) {
        const kinds = relations.flatMap((t) =>
            t === 'table' ? ["'table'", "'virtual'"] : ["'view'"],
        );
        parts.push(`
select case type when 'virtual' then 'table' else type end as "kind", schema || '.' || name as "object", null as "column"
from pragma_table_list
where type in (${kinds.join(', ')}) and ${NOT_INTERNAL} and name like @pattern escape '\\'`);
    }
    const schemaObjects = types.filter((t) => t === 'index' || t === 'trigger');
    if (schemaObjects.length > 0) {
        parts.push(`
select type as "kind", 'main.' || name as "object", tbl_name as "column"
from main.sqlite_schema
where type in (${schemaObjects.map((t) => `'${t}'`).join(', ')}) and ${NOT_INTERNAL} and name like @pattern escape '\\'`);
    }
    if (types.includes('column')) {
        parts.push(`
select 'column' as "kind", m.schema || '.' || m.name as "object", c.name as "column"
from pragma_table_list as m
    join pragma_table_info(m.name, m.schema) as c
where m.type in ('table', 'view', 'virtual') and m.${NOT_INTERNAL} and c.name like @pattern escape '\\'`);
    }
    return `${parts.join('\nunion all')}\norder by "kind", "object", "column"`;
};

export const searchObjectsTool: ToolDefinition<typeof inputSchema> = {
    name: 'search_objects',
    title: 'Search objects',
    description:
        'Finds tables, views, indexes, triggers and columns whose name contains a substring. For an index or trigger the "column" field holds the table it belongs to.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({
            database,
            maxRows: args.limit,
            params: { pattern: likePattern(args.pattern, context.dialect.likeEscape) },
            signal: context.signal,
            sql: buildSql(args.types),
        });
        return resultOutput(result);
    },
};
