import { describe, expect, it } from 'vitest';
import { toPositionalParams } from '../../src/sql/params.js';

describe('toPositionalParams', () => {
    it('rewrites @name placeholders to $n in first-seen order and returns the values', () => {
        const result = toPositionalParams('select * from t where a = @a and b = @b or a = @a', {
            a: 1,
            b: 'x',
        });
        expect(result.sql).toBe('select * from t where a = $1 and b = $2 or a = $1');
        expect(result.values).toEqual([1, 'x']);
    });

    it('leaves $n placeholders alone and appends nothing for them', () => {
        const result = toPositionalParams('select $1, @x', { x: 2 });
        expect(result.sql).toBe('select $1, $2');
        expect(result.values).toEqual([2]);
    });

    it('does not touch @ inside string literals, dollar quotes, comments or jsonb operators', () => {
        const sql = "select '@a', $$@a$$, data @> '{}' -- @a\n, @a";
        const result = toPositionalParams(sql, { a: 5 });
        expect(result.sql).toBe("select '@a', $$@a$$, data @> '{}' -- @a\n, $1");
        expect(result.values).toEqual([5]);
    });

    it('fails clearly when a placeholder has no value', () => {
        expect(() => toPositionalParams('select @missing', {})).toThrow(/@missing/);
    });

    it('returns the sql unchanged when there are no params', () => {
        expect(toPositionalParams('select 1', undefined)).toEqual({ sql: 'select 1', values: [] });
    });
});

describe('toPositionalParams edge cases', () => {
    it('skips unterminated comments and strings without throwing', () => {
        expect(toPositionalParams('select @a -- trailing @b', { a: 1 }).sql).toBe(
            'select $1 -- trailing @b',
        );
        expect(toPositionalParams('select @a /* open @b', { a: 1 }).sql).toBe(
            'select $1 /* open @b',
        );
        expect(toPositionalParams("select @a, 'open @b", { a: 1 }).sql).toBe("select $1, 'open @b");
    });

    it('keeps doubled quotes inside literals and identifiers intact', () => {
        const { sql, values } = toPositionalParams(`select 'it''s @a', "we""ird @b", @c`, { c: 3 });
        expect(sql).toBe(`select 'it''s @a', "we""ird @b", $1`);
        expect(values).toEqual([3]);
    });

    it('skips an unterminated dollar quote', () => {
        expect(toPositionalParams('select $body$ @a', {}).sql).toBe('select $body$ @a');
    });

    it('reuses the same placeholder index when a name repeats', () => {
        const { sql, values } = toPositionalParams('select @a, @b, @a', { a: 1, b: 2 });
        expect(sql).toBe('select $1, $2, $1');
        expect(values).toEqual([1, 2]);
    });

    it('treats a lone @ or an @ operator as literal text', () => {
        expect(toPositionalParams("select data @> '{}' , 1 @ 2", {}).sql).toBe(
            "select data @> '{}' , 1 @ 2",
        );
    });
});
