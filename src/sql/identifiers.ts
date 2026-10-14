/**
 * Safe handling of SQL Server identifiers. Object names coming from tool input
 * are never interpolated raw; they are parsed, validated and bracket-quoted.
 */
export type ObjectName = {
    name: string;
    schema: string;
};

const MAX_IDENTIFIER_LENGTH = 128;

const stripBrackets = (part: string): string => {
    const trimmed = part.trim();
    const isBracketed = trimmed.startsWith('[') && trimmed.endsWith(']');
    return isBracketed ? trimmed.slice(1, -1).replace(/\]\]/g, ']') : trimmed;
};

/** Bracket-quotes an identifier, escaping embedded closing brackets. */
export const quoteIdentifier = (identifier: string): string => {
    const bare = stripBrackets(identifier);
    const isValidLength = bare.length > 0 && bare.length <= MAX_IDENTIFIER_LENGTH;
    if (!isValidLength) {
        throw new Error(
            `Invalid identifier "${identifier}": must be 1-${MAX_IDENTIFIER_LENGTH} characters.`,
        );
    }
    return `[${bare.replace(/]/g, ']]')}]`;
};

const splitParts = (input: string): string[] => {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    for (const ch of input) {
        if (ch === '[') {
            depth++;
        } else if (ch === ']') {
            depth = Math.max(0, depth - 1);
        }
        const isSeparator = ch === '.' && depth === 0;
        if (isSeparator) {
            parts.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts;
};

/**
 * Parses `name` or `schema.name` (optionally bracketed). An explicit `schema`
 * argument applies when the input has no schema part. Defaults to `dbo`.
 */
export const parseObjectName = (input: string, schema?: string): ObjectName => {
    const parts = splitParts(input).map(stripBrackets);
    if (parts.length > 2) {
        throw new Error(
            `Object name "${input}" must be "name" or "schema.name"; cross-database names are not supported.`,
        );
    }
    if (parts.length === 2) {
        return { schema: parts[0] ?? 'dbo', name: parts[1] ?? '' };
    }
    return { schema: schema ? stripBrackets(schema) : 'dbo', name: parts[0] ?? '' };
};

/** `[schema].[name]` with both parts quoted. */
export const qualifiedName = (object: ObjectName): string =>
    `${quoteIdentifier(object.schema)}.${quoteIdentifier(object.name)}`;
