/**
 * Rewrites `@name` placeholders into Oracle's native `:b_name` binds and splits
 * a batch into statements. Occurrences inside string literals, q-quoted
 * strings, quoted identifiers and comments are left untouched. Bind names get
 * a `b_` prefix because Oracle rejects reserved words such as `:table` as bind
 * names (ORA-01745).
 */
export type BindQuery = {
    binds: Record<string, string | number | Date | Buffer | null>;
    sql: string;
};

const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

/** Oracle has no boolean SQL binds; booleans travel as 1/0. */
const toBindValue = (value: unknown): string | number | Date | Buffer | null => {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        return value;
    }
    if (value instanceof Date || Buffer.isBuffer(value)) {
        return value;
    }
    return JSON.stringify(value);
};

/** Index just past the literal starting at `i` (a `'` or `q'[...]'` literal). */
const skipStringLiteral = (sql: string, i: number): number => {
    const n = sql.length;
    const isQQuote = /^q'/i.test(sql.slice(i, i + 2));
    if (isQQuote) {
        const open = sql[i + 2] ?? '';
        const closers: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' };
        const close = closers[open] ?? open;
        const end = sql.indexOf(`${close}'`, i + 3);
        return end === -1 ? n : end + 2;
    }
    let j = i + 1;
    while (j < n) {
        if (sql[j] === "'") {
            if (sql[j + 1] === "'") {
                j += 2;
                continue;
            }
            return j + 1;
        }
        j++;
    }
    return n;
};

type Visitor = {
    onCode: (ch: string, index: number) => number | undefined;
    onSkipped: (text: string) => void;
};

/** Walks the SQL, handing comments/literals/identifiers to `onSkipped` and code characters to `onCode`. */
const walk = (sql: string, visitor: Visitor): void => {
    const n = sql.length;
    let i = 0;
    while (i < n) {
        const ch = sql[i] ?? '';
        if (sql.startsWith('--', i)) {
            const end = sql.indexOf('\n', i);
            const stop = end === -1 ? n : end;
            visitor.onSkipped(sql.slice(i, stop));
            i = stop;
            continue;
        }
        if (sql.startsWith('/*', i)) {
            const end = sql.indexOf('*/', i + 2);
            const stop = end === -1 ? n : end + 2;
            visitor.onSkipped(sql.slice(i, stop));
            i = stop;
            continue;
        }
        const startsQQuote = (ch === 'q' || ch === 'Q') && sql[i + 1] === "'";
        if (ch === "'" || startsQQuote) {
            const stop = skipStringLiteral(sql, i);
            visitor.onSkipped(sql.slice(i, stop));
            i = stop;
            continue;
        }
        if (ch === '"') {
            const end = sql.indexOf('"', i + 1);
            const stop = end === -1 ? n : end + 1;
            visitor.onSkipped(sql.slice(i, stop));
            i = stop;
            continue;
        }
        const consumed = visitor.onCode(ch, i);
        i += consumed ?? 1;
    }
};

export const toBindParams = (
    sql: string,
    params: Record<string, unknown> | undefined,
): BindQuery => {
    if (!params) {
        return { binds: {}, sql };
    }
    const binds: BindQuery['binds'] = {};
    let out = '';
    walk(sql, {
        onSkipped: (text) => {
            out += text;
        },
        onCode: (ch, i) => {
            if (ch === '@') {
                const name = NAME.exec(sql.slice(i + 1))?.[0];
                if (name) {
                    if (!(name in params)) {
                        throw new Error(
                            `Parameter @${name} is used in the SQL but missing from params.`,
                        );
                    }
                    binds[`b_${name}`] = toBindValue(params[name]);
                    out += `:b_${name}`;
                    return 1 + name.length;
                }
            }
            out += ch;
            return 1;
        },
    });
    return { binds, sql: out };
};

/**
 * Splits a batch on top-level semicolons. A PL/SQL block (`declare`/`begin`
 * at the start) is kept whole up to its terminating `end;`. Empty statements
 * and a trailing `/` are dropped.
 */
export const splitStatements = (sql: string): string[] => {
    const trimmed = sql.trim();
    if (/^(declare|begin)\b/i.test(trimmed)) {
        return [trimmed.replace(/\s*\/\s*$/, '')];
    }
    const statements: string[] = [];
    let current = '';
    let depth = 0;
    walk(sql, {
        onSkipped: (text) => {
            current += text;
        },
        onCode: (ch) => {
            if (ch === '(') {
                depth++;
            } else if (ch === ')') {
                depth = Math.max(0, depth - 1);
            } else if (ch === ';' && depth === 0) {
                statements.push(current);
                current = '';
                return 1;
            }
            current += ch;
            return 1;
        },
    });
    statements.push(current);
    return statements.map((s) => s.trim()).filter((s) => s.length > 0 && s !== '/');
};
