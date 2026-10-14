/**
 * Rewrites `@name` placeholders into mysql2's positional `?` form. Repeated
 * names repeat their value. Occurrences inside string literals, backtick
 * identifiers and comments (`--`, `#`, block) are left untouched, as are
 * `@@system` variables and `@` in operator context.
 */
export type PositionalQuery = {
    sql: string;
    values: unknown[];
};

const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

const skipQuoted = (sql: string, start: number, quote: string): number => {
    let j = start + 1;
    while (j < sql.length) {
        const ch = sql[j];
        if (ch === '\\' && quote !== '`') {
            j += 2;
            continue;
        }
        if (ch === quote) {
            if (sql[j + 1] === quote) {
                j += 2;
                continue;
            }
            break;
        }
        j++;
    }
    return j + 1;
};

export const toPositionalParams = (
    sql: string,
    params: Record<string, unknown> | undefined,
): PositionalQuery => {
    if (!params) {
        return { sql, values: [] };
    }
    const values: unknown[] = [];
    let out = '';
    let i = 0;
    const n = sql.length;
    while (i < n) {
        const ch = sql[i] ?? '';
        if (sql.startsWith('--', i) || ch === '#') {
            const end = sql.indexOf('\n', i);
            const stop = end === -1 ? n : end;
            out += sql.slice(i, stop);
            i = stop;
            continue;
        }
        if (sql.startsWith('/*', i)) {
            const end = sql.indexOf('*/', i + 2);
            const stop = end === -1 ? n : end + 2;
            out += sql.slice(i, stop);
            i = stop;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            const stop = Math.min(n, skipQuoted(sql, i, ch));
            out += sql.slice(i, stop);
            i = stop;
            continue;
        }
        if (ch === '@') {
            const name = NAME.exec(sql.slice(i + 1));
            const previous = sql[i - 1] ?? '';
            const isOperatorContext =
                /[@<>=!?&|#-]/.test(previous) || /[@<>=!?&|#-]/.test(sql[i + 1] ?? '');
            if (name && !isOperatorContext) {
                if (!(name[0] in params)) {
                    throw new Error(
                        `Parameter @${name[0]} is used in the SQL but missing from params.`,
                    );
                }
                values.push(params[name[0]]);
                out += '?';
                i += 1 + name[0].length;
                continue;
            }
        }
        out += ch;
        i++;
    }
    return { sql: out, values };
};
