/**
 * Rewrites `@name` placeholders into PostgreSQL's positional `$n` form.
 * Occurrences inside string literals, dollar-quoted strings, quoted
 * identifiers and comments are left untouched, as are operators such as `@>`.
 */
export type PositionalQuery = {
    sql: string;
    values: unknown[];
};

const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

export const toPositionalParams = (
    sql: string,
    params: Record<string, unknown> | undefined,
): PositionalQuery => {
    if (!params) {
        return { sql, values: [] };
    }
    const order: string[] = [];
    const indexOf = (name: string): number => {
        const existing = order.indexOf(name);
        if (existing !== -1) {
            return existing + 1;
        }
        if (!(name in params)) {
            throw new Error(`Parameter @${name} is used in the SQL but missing from params.`);
        }
        order.push(name);
        return order.length;
    };
    const highestExisting = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));

    let out = '';
    let i = 0;
    const n = sql.length;
    while (i < n) {
        const ch = sql[i] ?? '';
        if (sql.startsWith('--', i)) {
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
        if (ch === '$') {
            const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
            if (tag) {
                const end = sql.indexOf(tag[0], i + tag[0].length);
                const stop = end === -1 ? n : end + tag[0].length;
                out += sql.slice(i, stop);
                i = stop;
                continue;
            }
        }
        if (ch === "'" || ch === '"') {
            let j = i + 1;
            while (j < n) {
                if (sql[j] === ch) {
                    if (sql[j + 1] === ch) {
                        j += 2;
                        continue;
                    }
                    break;
                }
                j++;
            }
            out += sql.slice(i, j + 1);
            i = j + 1;
            continue;
        }
        if (ch === '@') {
            const name = NAME.exec(sql.slice(i + 1));
            const previous = sql[i - 1] ?? '';
            const isOperatorContext =
                /[@<>=!?&|#-]/.test(previous) || /[@<>=!?&|#-]/.test(sql[i + 1] ?? '');
            if (name && !isOperatorContext) {
                out += `$${highestExisting + indexOf(name[0])}`;
                i += 1 + name[0].length;
                continue;
            }
        }
        out += ch;
        i++;
    }
    return { sql: out, values: order.map((name) => params[name]) };
};
