import type { QueryResult } from './sql/executor.js';

export type OutputFormat = 'csv' | 'json' | 'markdown';

/** Converts driver values into JSON-friendly primitives. */
export const normalizeValue = (value: unknown): unknown => {
    if (value === undefined) {
        return null;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Buffer.isBuffer(value)) {
        return `0x${value.toString('hex').toUpperCase()}`;
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    return value;
};

const normalizeRows = (rows: unknown[][]): unknown[][] =>
    rows.map((row) => row.map(normalizeValue));

const cell = (value: unknown): string => {
    const normalized = normalizeValue(value);
    if (normalized === null) {
        return 'NULL';
    }
    if (typeof normalized === 'object') {
        return JSON.stringify(normalized);
    }
    return String(normalized);
};

const footer = (result: QueryResult): string[] => {
    const lines: string[] = [];
    const hasResultSet = result.columns.length > 0;
    if (!hasResultSet) {
        const affected = result.rowsAffected.reduce((sum, n) => sum + n, 0);
        lines.push(`${affected} row(s) affected.`);
    }
    if (result.truncated) {
        lines.push(
            `Result truncated to the first ${result.rowCount} row(s); add a WHERE clause or TOP to narrow it.`,
        );
    }
    for (const message of result.messages) {
        lines.push(message);
    }
    return lines;
};

const toJson = (result: QueryResult): string =>
    JSON.stringify({
        columns: result.columns.map((column) => column.name),
        rowCount: result.rowCount,
        rows: normalizeRows(result.rows),
        truncated: result.truncated,
        ...(result.columns.length === 0 ? { rowsAffected: result.rowsAffected } : {}),
        ...(result.messages.length > 0 ? { messages: result.messages } : {}),
    });

const toMarkdown = (result: QueryResult): string => {
    const lines: string[] = [];
    if (result.columns.length > 0) {
        const escape = (text: string) => text.replace(/\|/g, '\\|');
        lines.push(`| ${result.columns.map((c) => escape(c.name)).join(' | ')} |`);
        lines.push(`| ${result.columns.map(() => '---').join(' | ')} |`);
        for (const row of result.rows) {
            lines.push(`| ${row.map((value) => escape(cell(value))).join(' | ')} |`);
        }
        lines.push('');
        lines.push(`${result.rowCount} row(s).`);
    }
    lines.push(...footer(result));
    return lines.join('\n');
};

const csvCell = (value: unknown): string => {
    const normalized = normalizeValue(value);
    if (normalized === null) {
        return '';
    }
    const text = typeof normalized === 'object' ? JSON.stringify(normalized) : String(normalized);
    const needsQuotes = /[",\r\n]/.test(text);
    return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsv = (result: QueryResult): string => {
    const lines = [result.columns.map((c) => csvCell(c.name)).join(',')];
    for (const row of result.rows) {
        lines.push(row.map(csvCell).join(','));
    }
    const notes = footer(result);
    if (notes.length > 0) {
        lines.push('', ...notes.map((note) => `# ${note}`));
    }
    return lines.join('\n');
};

/** Renders a query result in the requested format. */
export const formatResult = (result: QueryResult, format: OutputFormat): string => {
    switch (format) {
        case 'csv':
            return toCsv(result);
        case 'markdown':
            return toMarkdown(result);
        default:
            return toJson(result);
    }
};
