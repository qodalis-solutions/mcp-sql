import { z } from 'zod';
import {
    databaseArg,
    likePattern,
    READ_ONLY_ANNOTATIONS,
    resultOutput,
    schemaArg,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';
import { resolveSchema } from './shared.js';

const OBJECT_TYPES = [
    'column',
    'function',
    'package',
    'procedure',
    'sequence',
    'table',
    'trigger',
    'view',
] as const;

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
    schema: schemaArg,
    types: z
        .array(z.enum(OBJECT_TYPES))
        .min(1)
        .default([...OBJECT_TYPES])
        .describe('Which kinds of objects to search. Defaults to all.'),
});

const OBJECT_TYPE_NAMES: Record<Exclude<(typeof OBJECT_TYPES)[number], 'column'>, string[]> = {
    function: ['FUNCTION'],
    package: ['PACKAGE'],
    procedure: ['PROCEDURE'],
    sequence: ['SEQUENCE'],
    table: ['TABLE'],
    trigger: ['TRIGGER'],
    view: ['VIEW', 'MATERIALIZED VIEW'],
};

const buildSql = (types: ReadonlyArray<(typeof OBJECT_TYPES)[number]>): string => {
    const parts: string[] = [];
    const objectTypes = types.flatMap((type) => (type === 'column' ? [] : OBJECT_TYPE_NAMES[type]));
    if (objectTypes.length > 0) {
        parts.push(`
select
    lower(o.object_type) as "kind",
    o.owner || '.' || o.object_name as "object",
    cast(null as varchar2(128)) as "column"
from all_objects o
where o.owner = @schema and o.object_type in (${objectTypes.map((t) => `'${t}'`).join(', ')}) and o.object_name not like 'BIN$%'
    and upper(o.object_name) like upper(@pattern) escape '\\'`);
    }
    if (types.includes('column')) {
        parts.push(`
select
    'column' as "kind",
    c.owner || '.' || c.table_name as "object",
    c.column_name as "column"
from all_tab_columns c
where c.owner = @schema and upper(c.column_name) like upper(@pattern) escape '\\'`);
    }
    return `select * from (${parts.join('\nunion all')}\n) order by "kind", "object", "column"`;
};

export const searchObjectsTool: ToolDefinition<typeof inputSchema> = {
    name: 'search_objects',
    title: 'Search objects',
    description:
        'Finds tables, views, routines, packages, triggers, sequences and columns of a schema whose name contains a substring. The fastest way to locate where something lives.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const { database, schema } = resolveSchema(context, args.schema, args.database);
        const result = await context.executor.run({
            database,
            maxRows: args.limit,
            params: { pattern: likePattern(args.pattern, context.dialect.likeEscape), schema },
            signal: context.signal,
            sql: buildSql(args.types),
        });
        return resultOutput(result);
    },
};
