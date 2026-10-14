import { z } from 'zod';
import { resolveDatabase, type ToolDefinition } from './context.js';
import { databaseArg, likePattern, READ_ONLY_ANNOTATIONS, resultOutput } from './shared.js';

const OBJECT_TYPES = ['column', 'function', 'procedure', 'table', 'view'] as const;

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

const TYPE_CODES: Record<(typeof OBJECT_TYPES)[number], string[]> = {
    column: [],
    function: ['FN', 'IF', 'TF', 'FS', 'FT'],
    procedure: ['P', 'PC'],
    table: ['U'],
    view: ['V'],
};

const buildSql = (types: ReadonlyArray<(typeof OBJECT_TYPES)[number]>): string => {
    const codes = types.flatMap((type) => TYPE_CODES[type]);
    const parts: string[] = [];
    if (codes.length > 0) {
        parts.push(`
select
    lower(replace(replace([o].[type_desc], 'USER_', ''), 'SQL_', '')) as [kind],
    schema_name([o].[schema_id]) + '.' + [o].[name] as [object],
    null as [column]
from sys.objects as [o]
where [o].[is_ms_shipped] = 0 and [o].[type] in (${codes.map((code) => `'${code}'`).join(', ')}) and [o].[name] like @pattern`);
    }
    if (types.includes('column')) {
        parts.push(`
select
    'column' as [kind],
    schema_name([o].[schema_id]) + '.' + [o].[name] as [object],
    [c].[name] as [column]
from sys.columns as [c]
    join sys.objects as [o] on [o].[object_id] = [c].[object_id]
where [o].[is_ms_shipped] = 0 and [o].[type] in ('U', 'V') and [c].[name] like @pattern`);
    }
    return `${parts.join('\nunion all')}\norder by [kind], [object], [column]`;
};

export const searchObjectsTool: ToolDefinition<typeof inputSchema> = {
    name: 'search_objects',
    title: 'Search objects',
    description:
        'Finds tables, views, procedures, functions and columns whose name contains a substring. The fastest way to locate where something lives in an unfamiliar database.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({
            database,
            maxRows: args.limit,
            params: { pattern: likePattern(args.pattern) },
            signal: context.signal,
            sql: buildSql(args.types),
        });
        return resultOutput(result);
    },
};
