import { z } from 'zod';
import {
    databaseArg,
    likePattern,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    resultOutput,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

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

const RELKINDS: Record<'table' | 'view', string[]> = { table: ['r', 'p', 'f'], view: ['v', 'm'] };

const SYSTEM =
    "n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'";

const buildSql = (types: ReadonlyArray<(typeof OBJECT_TYPES)[number]>): string => {
    const parts: string[] = [];
    const relkinds = types.flatMap((type) =>
        type === 'table' || type === 'view' ? RELKINDS[type] : [],
    );
    if (relkinds.length > 0) {
        parts.push(`
select
    case c.relkind when 'v' then 'view' when 'm' then 'materialized view' when 'p' then 'partitioned table' when 'f' then 'foreign table' else 'table' end as "kind",
    n.nspname || '.' || c.relname as "object",
    null::text as "column"
from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
where c.relkind in (${relkinds.map((k) => `'${k}'`).join(', ')}) and ${SYSTEM} and c.relname ilike @pattern escape '\\'`);
    }
    const wantsRoutines = types.includes('function') || types.includes('procedure');
    if (wantsRoutines) {
        const kinds = [
            ...(types.includes('function') ? ["'f'", "'a'", "'w'"] : []),
            ...(types.includes('procedure') ? ["'p'"] : []),
        ];
        parts.push(`
select
    case p.prokind when 'p' then 'procedure' else 'function' end as "kind",
    n.nspname || '.' || p.proname as "object",
    null::text as "column"
from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
where p.prokind in (${kinds.join(', ')}) and ${SYSTEM} and p.proname ilike @pattern escape '\\'`);
    }
    if (types.includes('column')) {
        parts.push(`
select
    'column' as "kind",
    n.nspname || '.' || c.relname as "object",
    a.attname as "column"
from pg_attribute as a
    join pg_class as c on c.oid = a.attrelid
    join pg_namespace as n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped and ${SYSTEM} and a.attname ilike @pattern escape '\\'`);
    }
    return `${parts.join('\nunion all')}\norder by "kind", "object", "column"`;
};

export const searchObjectsTool: ToolDefinition<typeof inputSchema> = {
    name: 'search_objects',
    title: 'Search objects',
    description:
        'Finds tables, views, functions, procedures and columns whose name contains a substring. The fastest way to locate where something lives in an unfamiliar database.',
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
