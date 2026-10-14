import { describe, expect, it } from 'vitest';
import { splitStatements, toBindParams } from '../../src/sql/params.js';

describe('toBindParams', () => {
    it('rewrites @name to :b_name (reserved words such as table cannot be bind names) and collects the binds', () => {
        const { sql, binds } = toBindParams('select * from t where id = @id and name = @name', {
            id: 7,
            name: 'x',
        });
        expect(sql).toBe('select * from t where id = :b_id and name = :b_name');
        expect(binds).toEqual({ b_id: 7, b_name: 'x' });
    });

    it('does not touch @ inside string literals, q-quotes, quoted identifiers or comments', () => {
        const input = `select '@a', q'[@b]', "col@c", @d -- @e\n/* @f */ from t`;
        const { sql, binds } = toBindParams(input, { d: 1 });
        expect(sql).toBe(`select '@a', q'[@b]', "col@c", :b_d -- @e\n/* @f */ from t`);
        expect(binds).toEqual({ b_d: 1 });
    });

    it('fails clearly when a placeholder has no value', () => {
        expect(() => toBindParams('select @missing from dual', {})).toThrow(/@missing/);
    });

    it('converts booleans to 1/0 and objects to JSON, keeps dates and buffers', () => {
        const date = new Date('2026-01-01T00:00:00Z');
        const buffer = Buffer.from([1, 2]);
        const { binds } = toBindParams('select @t, @f, @o, @d, @b, @n', {
            t: true,
            f: false,
            o: { a: 1 },
            d: date,
            b: buffer,
            n: null,
        });
        expect(binds).toEqual({
            b_t: 1,
            b_f: 0,
            b_o: '{"a":1}',
            b_d: date,
            b_b: buffer,
            b_n: null,
        });
    });

    it('returns the sql unchanged when there are no params', () => {
        expect(toBindParams('select @x', undefined)).toEqual({ sql: 'select @x', binds: {} });
    });
});

describe('splitStatements', () => {
    it('splits on top-level semicolons and drops empties and a trailing slash', () => {
        expect(splitStatements('select 1 from dual; select 2 from dual;\n/')).toEqual([
            'select 1 from dual',
            'select 2 from dual',
        ]);
    });

    it('ignores semicolons inside literals, comments, quoted identifiers and parentheses', () => {
        expect(
            splitStatements(`select ';' as a, "b;c", (select 1 from dual) from dual -- ;\n/* ; */`),
        ).toHaveLength(1);
    });

    it('keeps a PL/SQL block whole', () => {
        const block = 'begin\n  null;\n  null;\nend;';
        expect(splitStatements(`${block}\n/`)).toEqual([block]);
        expect(splitStatements('declare x number; begin x := 1; end;')).toHaveLength(1);
    });
});
