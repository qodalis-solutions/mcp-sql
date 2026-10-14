import { describe, expect, it } from 'vitest';
import { classifyStatement, splitStatements } from '../../src/sql/statements.js';

describe('splitStatements', () => {
    it('splits at top-level semicolons and drops empty trailing pieces', () => {
        expect(splitStatements('select 1; select 2;')).toEqual(['select 1', 'select 2']);
    });

    it.each([
        "select ';' as semi",
        'select "a;b"',
        'select [a;b]',
        'select `a;b`',
        'select 1 -- ; comment\n',
        'select 1 /* ; block */',
        'select (select 1; ) as nested',
        "select 'it''s; fine'",
    ])('keeps %j as one statement', (sql) => {
        expect(splitStatements(sql)).toHaveLength(1);
    });

    it('keeps a trigger body together', () => {
        const trigger =
            "create trigger tr after insert on t begin insert into log values ('x'); update t set a = 1; end";
        expect(splitStatements(`${trigger}; select 1`)).toEqual([trigger, 'select 1']);
    });

    it('keeps a temp trigger with if not exists together', () => {
        const trigger =
            "create temp trigger if not exists tr before delete on t begin select raise(abort, 'no'); end";
        expect(splitStatements(trigger)).toEqual([trigger]);
    });
});

describe('classifyStatement', () => {
    it.each([
        ['select 1', 'rows'],
        ['with c as (select 1) select * from c', 'rows'],
        ['values (1)', 'rows'],
        ['pragma table_info(t)', 'rows'],
        ['explain select 1', 'rows'],
        ['insert into t values (1)', 'changes'],
        ['insert or replace into t values (1)', 'changes'],
        ['replace into t values (1)', 'changes'],
        ['update t set a = 1', 'changes'],
        ['delete from t', 'changes'],
        ['create table t (a)', 'exec'],
        ['drop table t', 'exec'],
        ['begin', 'exec'],
        ['insert into t values (1) returning id', 'rows'],
    ])('classifies %j as %s', (sql, kind) => {
        expect(classifyStatement(sql)).toBe(kind);
    });
});
