/**
 * Statement splitting and classification for SQLite batches. node:sqlite runs
 * one prepared statement at a time, so a batch is split at top-level
 * semicolons; a `CREATE TRIGGER ... BEGIN ... END` body stays whole.
 */
export type StatementKind = 'changes' | 'exec' | 'rows';

const QUOTES: Record<string, string> = { "'": "'", '"': '"', '[': ']', '`': '`' };

const skipQuoted = (sql: string, start: number, close: string): number => {
    let i = start + 1;
    while (i < sql.length) {
        if (sql[i] === close) {
            if (sql[i + 1] === close && close !== ']') {
                i += 2;
                continue;
            }
            return i + 1;
        }
        i++;
    }
    return sql.length;
};

const skipComment = (sql: string, start: number): number | undefined => {
    if (sql.startsWith('--', start)) {
        const end = sql.indexOf('\n', start);
        return end === -1 ? sql.length : end + 1;
    }
    if (sql.startsWith('/*', start)) {
        const end = sql.indexOf('*/', start + 2);
        return end === -1 ? sql.length : end + 2;
    }
    return undefined;
};

const isTriggerStart = (statement: string): boolean =>
    /^\s*create\s+(?:(?:temp|temporary)\s+)?trigger\b/i.test(statement);

const endsTriggerBody = (statement: string): boolean => /\bend\s*$/i.test(statement);

/** Splits a batch into statements, honouring quotes, comments, parentheses and trigger bodies. */
export const splitStatements = (sql: string): string[] => {
    const pieces: string[] = [];
    let current = '';
    let depth = 0;
    let i = 0;
    while (i < sql.length) {
        const ch = sql[i] ?? '';
        const afterComment = skipComment(sql, i);
        if (afterComment !== undefined) {
            current += sql.slice(i, afterComment);
            i = afterComment;
            continue;
        }
        const close = QUOTES[ch];
        if (close) {
            const end = skipQuoted(sql, i, close);
            current += sql.slice(i, end);
            i = end;
            continue;
        }
        if (ch === '(') {
            depth++;
        } else if (ch === ')') {
            depth = Math.max(0, depth - 1);
        } else if (ch === ';' && depth === 0) {
            pieces.push(current);
            current = '';
            i++;
            continue;
        }
        current += ch;
        i++;
    }
    pieces.push(current);

    const statements: string[] = [];
    let pending: string | undefined;
    for (const piece of pieces) {
        if (pending !== undefined) {
            pending += `;${piece}`;
            if (endsTriggerBody(piece)) {
                statements.push(pending);
                pending = undefined;
            }
            continue;
        }
        if (isTriggerStart(piece) && !endsTriggerBody(piece)) {
            pending = piece;
            continue;
        }
        statements.push(piece);
    }
    if (pending !== undefined) {
        statements.push(pending);
    }
    return statements.map((s) => s.trim()).filter((s) => s.length > 0);
};

const leadingKeyword = (statement: string): string => {
    const match = /^\s*(?:\/\*[\s\S]*?\*\/\s*|--[^\n]*\n\s*)*(\w+)/.exec(statement);
    return (match?.[1] ?? '').toLowerCase();
};

/**
 * `rows` statements are read through a prepared statement, `changes` ones
 * through `run()` (which reports the affected rows), and `exec` ones through
 * `exec()` (DDL, transactions, pragma assignments).
 */
export const classifyStatement = (statement: string): StatementKind => {
    const keyword = leadingKeyword(statement);
    if (['select', 'with', 'values', 'pragma', 'explain'].includes(keyword)) {
        return 'rows';
    }
    if (['insert', 'replace', 'update', 'delete'].includes(keyword)) {
        return /\breturning\b/i.test(statement) ? 'rows' : 'changes';
    }
    return 'exec';
};
