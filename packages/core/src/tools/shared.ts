import { z } from 'zod';
import type { Dialect } from '../dialect.js';
import { formatResult } from '../format.js';
import type { QueryResult } from '../sql/executor.js';
import type { ObjectName } from '../sql/identifiers.js';
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
    .describe('Schema name filter, e.g. "dbo" or "public".');

export const nameContainsArg = z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Case-insensitive substring to match against object names.');

export type LikeEscapeStyle = 'backslash' | 'brackets';

/**
 * `%fragment%` with LIKE wildcards escaped. `brackets` wraps each wildcard as
 * `[%]` (SQL Server); `backslash` prefixes it (PostgreSQL, MySQL default).
 */
export const likePattern = (
    fragment: string | undefined,
    style: LikeEscapeStyle = 'backslash',
): string | null => {
    if (!fragment) {
        return null;
    }
    const escaped =
        style === 'brackets'
            ? fragment.replace(/[%_[]/g, (ch) => `[${ch}]`)
            : fragment.replace(/[%_\\]/g, (ch) => `\\${ch}`);
    return `%${escaped}%`;
};

export const objectParams = (
    dialect: Dialect,
    table: string,
    schema?: string,
): { object: ObjectName; params: Record<string, string> } => {
    const object = dialect.identifiers.parseObjectName(table, schema);
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
