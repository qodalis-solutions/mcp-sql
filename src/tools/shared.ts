import { z } from 'zod';
import type { QueryResult } from '../sql/executor.js';
import { formatResult } from '../format.js';
import { parseObjectName, type ObjectName } from '../sql/identifiers.js';
import type { ToolOutput } from './context.js';

export const databaseArg = z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
        'Database to query. Defaults to the configured database; must be on the allowlist when one is set.',
    );

export const schemaArg = z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Schema name filter, e.g. "dbo".');

export const nameContainsArg = z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Case-insensitive substring to match against object names.');

export const likePattern = (fragment: string | undefined): string | null =>
    fragment ? `%${fragment.replace(/[%_[]/g, (ch) => `[${ch}]`)}%` : null;

export const objectParams = (
    table: string,
    schema?: string,
): { object: ObjectName; params: Record<string, string> } => {
    const object = parseObjectName(table, schema);
    return { object, params: { schema: object.schema, table: object.name } };
};

export const jsonOutput = (value: Record<string, unknown>, isError = false): ToolOutput => ({
    text: JSON.stringify(value),
    structured: value,
    ...(isError ? { isError: true } : {}),
});

export const resultOutput = (result: QueryResult): ToolOutput => ({
    text: formatResult(result, 'json'),
});

export const READ_ONLY_ANNOTATIONS = {
    readOnlyHint: true,
    idempotentHint: true,
    destructiveHint: false,
    openWorldHint: false,
};
