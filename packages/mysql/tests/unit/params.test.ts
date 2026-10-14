import { describe, expect, it } from 'vitest';
import { toPositionalParams } from '../../src/sql/params.js';

describe('toPositionalParams (mysql)', () => {
    it('rewrites @name placeholders to ? in order of appearance, repeating values for repeats', () => {
        const { sql, values } = toPositionalParams('select @a, @b, @a', { a: 1, b: 'x' });
        expect(sql).toBe('select ?, ?, ?');
        expect(values).toEqual([1, 'x', 1]);
    });

    it('leaves @@system variables, user variables in operator context and quoted text alone', () => {
        const input = 'select @@version, \'a@b\', `we@ird`, "q@q" -- @c\n/* @d */ # @e\n, @a';
        const { sql, values } = toPositionalParams(input, { a: 1 });
        expect(sql).toBe('select @@version, \'a@b\', `we@ird`, "q@q" -- @c\n/* @d */ # @e\n, ?');
        expect(values).toEqual([1]);
    });

    it('fails clearly when a placeholder has no value', () => {
        expect(() => toPositionalParams('select @missing', {})).toThrow(/@missing/);
    });

    it('returns the sql unchanged when there are no params', () => {
        expect(toPositionalParams('select @x', undefined)).toEqual({
            sql: 'select @x',
            values: [],
        });
    });

    it('keeps doubled quotes and backslash escapes inside literals intact', () => {
        const { sql } = toPositionalParams(`select 'it''s @a', 'back\\\\' , @b`, { b: 2 });
        expect(sql).toBe(`select 'it''s @a', 'back\\\\' , ?`);
    });
});
