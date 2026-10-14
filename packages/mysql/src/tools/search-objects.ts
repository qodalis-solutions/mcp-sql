import { z } from 'zod';
import {
    databaseArg,
    likePattern,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    resultOutput,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';
import { SYSTEM_SCHEMAS } from './scope.js';

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

const USER_SCHEMAS = `table_schema not in ${SYSTEM_SCHEMAS}`;

const buildSql = (types: ReadonlyArray<(typeof OBJECT_TYPES)[number]>): string => {
    const parts: string[] = [];
    const tableTypes = [
        ...(types.includes('table') ? ["'BASE TABLE'"] : []),
        ...(types.includes('view') ? ["'VIEW'"] : []),
    ];
    if (tableTypes.length > 0) {
        parts.push(`
select
    case table_type when 'VIEW' then 'view' else 'table' end as kind,
    concat(table_schema, '.', table_name) as object,
    null as \`column\`
from information_schema.tables
where table_type in (${tableTypes.join(', ')}) and ${USER_SCHEMAS} and table_name like @pattern`);
    }
    const routineTypes = [
        ...(types.includes('function') ? ["'FUNCTION'"] : []),
        ...(types.includes('procedure') ? ["'PROCEDURE'"] : []),
    ];
    if (routineTypes.length > 0) {
        parts.push(`
select
    lower(routine_type) as kind,
    concat(routine_schema, '.', routine_name) as object,
    null as \`column\`
from information_schema.routines
where routine_type in (${routineTypes.join(', ')}) and routine_schema not in ${SYSTEM_SCHEMAS} and routine_name like @pattern`);
    }
    if (types.includes('column')) {
        parts.push(`
select
    'column' as kind,
    concat(table_schema, '.', table_name) as object,
    column_name as \`column\`
from information_schema.columns
where ${USER_SCHEMAS} and column_name like @pattern`);
    }
    return `${parts.join('\nunion all')}\norder by kind, object, \`column\``;
};

export const searchObjectsTool: ToolDefinition<typeof inputSchema> = {
    name: 'search_objects',
    title: 'Search objects',
    description:
        'Finds tables, views, procedures, functions and columns whose name contains a substring, across every user database the login can see. The fastest way to locate where something lives.',
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
