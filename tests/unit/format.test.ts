import { describe, expect, it } from 'vitest';
import { formatResult, normalizeValue } from '../../src/format.js';
import type { QueryResult } from '../../src/sql/executor.js';

const result: QueryResult = {
    columns: [
        { name: 'Id', type: 'int', nullable: false },
        { name: 'Note', type: 'nvarchar', nullable: true },
    ],
    rows: [
        [1, 'plain'],
        [2, 'has | pipe, "quote"'],
        [3, null],
    ],
    rowCount: 3,
    truncated: false,
    rowsAffected: [3],
    messages: [],
    durationMs: 12,
};

describe('normalizeValue', () => {
    it('serialises dates as ISO strings', () => {
        expect(normalizeValue(new Date('2026-01-02T03:04:05.000Z'))).toBe(
            '2026-01-02T03:04:05.000Z',
        );
    });

    it('serialises binary as a hex literal', () => {
        expect(normalizeValue(Buffer.from([0xde, 0xad]))).toBe('0xDEAD');
    });

    it('serialises bigint as a string', () => {
        expect(normalizeValue(123n)).toBe('123');
    });

    it('maps undefined to null and leaves primitives alone', () => {
        expect(normalizeValue(undefined)).toBeNull();
        expect(normalizeValue(5)).toBe(5);
        expect(normalizeValue('x')).toBe('x');
        expect(normalizeValue(true)).toBe(true);
    });
});

describe('formatResult', () => {
    it('produces a compact JSON document with columns listed once', () => {
        const text = formatResult(result, 'json');
        const parsed = JSON.parse(text);

        expect(parsed.columns).toEqual(['Id', 'Note']);
        expect(parsed.rows).toEqual(result.rows);
        expect(parsed.rowCount).toBe(3);
        expect(parsed.truncated).toBe(false);
    });

    it('renders a markdown table with escaped pipes', () => {
        const text = formatResult(result, 'markdown');

        expect(text).toContain('| Id | Note |');
        expect(text).toContain('| --- | --- |');
        expect(text).toContain('| 2 | has \\| pipe, "quote" |');
        expect(text).toContain('| 3 | NULL |');
    });

    it('renders CSV with RFC 4180 quoting', () => {
        const text = formatResult(result, 'csv');

        expect(text.split('\n')[0]).toBe('Id,Note');
        expect(text.split('\n')[2]).toBe('2,"has | pipe, ""quote"""');
        expect(text.split('\n')[3]).toBe('3,');
    });

    it('adds a truncation note when the result was capped', () => {
        const text = formatResult({ ...result, truncated: true }, 'markdown');

        expect(text).toMatch(/truncated/i);
    });

    it('reports rows affected and messages for statements without a result set', () => {
        const text = formatResult(
            {
                ...result,
                columns: [],
                rows: [],
                rowCount: 0,
                rowsAffected: [4],
                messages: ['done'],
            },
            'markdown',
        );

        expect(text).toContain('4 row(s) affected');
        expect(text).toContain('done');
    });
});
