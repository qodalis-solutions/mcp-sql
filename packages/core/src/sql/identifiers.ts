/**
 * Safe handling of identifiers, parameterised by the dialect's quoting style.
 * Object names coming from tool input are never interpolated raw: they are
 * parsed, validated and quoted.
 */
export type ObjectName = {
    name: string;
    schema: string;
};

export type IdentifierStyle = {
    close: string;
    defaultSchema: string;
    maxLength: number;
    open: string;
};

export type IdentifierTools = {
    parseObjectName: (input: string, schema?: string) => ObjectName;
    qualifiedName: (object: ObjectName) => string;
    quoteIdentifier: (identifier: string) => string;
    style: IdentifierStyle;
};

export const createIdentifierTools = (style: IdentifierStyle): IdentifierTools => {
    const { open, close } = style;
    const doubledClose = close + close;

    const stripQuotes = (part: string): string => {
        const trimmed = part.trim();
        const isQuoted = trimmed.length >= 2 && trimmed.startsWith(open) && trimmed.endsWith(close);
        return isQuoted ? trimmed.slice(1, -1).split(doubledClose).join(close) : trimmed;
    };

    const quoteIdentifier = (identifier: string): string => {
        const bare = stripQuotes(identifier);
        const isValidLength = bare.length > 0 && bare.length <= style.maxLength;
        if (!isValidLength) {
            throw new Error(
                `Invalid identifier "${identifier}": must be 1-${style.maxLength} characters.`,
            );
        }
        return `${open}${bare.split(close).join(doubledClose)}${close}`;
    };

    const splitParts = (input: string): string[] => {
        const parts: string[] = [];
        let current = '';
        let quoted = false;
        for (let i = 0; i < input.length; i++) {
            const ch = input[i] ?? '';
            if (!quoted && ch === open) {
                quoted = true;
            } else if (quoted && ch === close) {
                if (input[i + 1] === close) {
                    current += ch;
                    i++;
                    continue;
                }
                quoted = false;
            }
            const isSeparator = ch === '.' && !quoted;
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

    const parseObjectName = (input: string, schema?: string): ObjectName => {
        const parts = splitParts(input).map(stripQuotes);
        if (parts.length > 2) {
            throw new Error(
                `Object name "${input}" must be "name" or "schema.name"; cross-database names are not supported.`,
            );
        }
        if (parts.length === 2) {
            return { schema: parts[0] || style.defaultSchema, name: parts[1] ?? '' };
        }
        return { schema: schema ? stripQuotes(schema) : style.defaultSchema, name: parts[0] ?? '' };
    };

    const qualifiedName = (object: ObjectName): string =>
        `${quoteIdentifier(object.schema)}.${quoteIdentifier(object.name)}`;

    return { parseObjectName, qualifiedName, quoteIdentifier, style };
};
