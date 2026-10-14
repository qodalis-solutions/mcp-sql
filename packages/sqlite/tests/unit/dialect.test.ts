import { describe, expect, it } from 'vitest';
import { scrubSql, validateSql } from '@qodalis/mcp-sql-core';
import { guardProfile, identifiers, sqliteDialect } from '../../src/dialect.js';

const ro = { readOnly: true };
const rw = { readOnly: false };
const check = (sql: string, options = ro) => validateSql(sql, options, guardProfile);

describe('sqlite guard profile', () => {
    it.each([
        'select * from customers',
        'SELECT id FROM orders ORDER BY id DESC LIMIT 10',
        'with cte as (select 1 as n) select n from cte',
        "select * from t where name = 'drop table x'",
        'select * from "my table" where [weird col] = `x`',
        'explain query plan select 1',
        'pragma table_info(orders)',
        'pragma journal_mode',
        'select * from pragma_table_list',
        'select * from sqlite_schema',
        'values (1), (2)',
        "select json_extract(data, '$.a') from t",
        'begin; select 1; commit',
    ])('allows read query: %s', (sql) => {
        expect(check(sql)).toEqual({ ok: true });
    });

    it.each([
        ['insert into t values (1)', 'INSERT'],
        ['insert or ignore into t values (1)', 'INSERT'],
        ['replace into t values (1)', 'REPLACE'],
        ['update t set a = 1', 'UPDATE'],
        ['update or replace t set a = 1', 'UPDATE'],
        ['delete from t', 'DELETE'],
        ['drop table t', 'DROP'],
        ['drop view v', 'DROP'],
        ['create table t (a int)', 'CREATE'],
        ['create view v as select 1', 'CREATE'],
        ['create index i on t (a)', 'CREATE'],
        ['create trigger tr after insert on t begin select 1; end', 'CREATE'],
        ['alter table t add b int', 'ALTER'],
        ['vacuum', 'VACUUM'],
        ['reindex', 'REINDEX'],
        ['analyze', 'ANALYZE'],
        ['pragma journal_mode = wal', 'PRAGMA'],
        ['pragma user_version = 3', 'PRAGMA'],
        ['select 1; delete from t', 'DELETE'],
    ])('rejects "%s" naming %s', (sql, keyword) => {
        const result = check(sql);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain(keyword);
        }
    });

    it.each([
        'create temp table tmp_a (a int); insert into tmp_a values (1); select * from tmp_a',
        'create temporary table tmp_b as select 1 as n',
        'create temp table if not exists tmp_c (a int)',
        'insert into temp.tmp_a values (2)',
        'insert or replace into temp.tmp_a values (2)',
        'update temp.tmp_a set a = 3',
        'delete from temp.tmp_a',
        'drop table temp.tmp_a',
        'drop table if exists temp.tmp_a',
        'create temp view tmp_v as select 1',
        'create temp table tmp_d (a); create index tmp_i on tmp_d (a)',
        'create temp table tmp_e (a); drop table tmp_e',
    ])('allows session-local temp work: %s', (sql) => {
        expect(check(sql)).toEqual({ ok: true });
    });

    it('rejects an unqualified write to a table that happens to be named like a temp table', () => {
        expect(check('insert into tmp_looks_temp values (1)').ok).toBe(false);
    });

    it.each([
        'insert into t values (1)',
        'update t set a = 1',
        'delete from t',
        'create table t (a int)',
        'alter table t add b int',
        'pragma journal_mode = wal',
        'vacuum',
    ])('allows in write mode: %s', (sql) => {
        expect(check(sql, rw)).toEqual({ ok: true });
    });

    it.each([
        ["attach database '/etc/x' as x", 'ATTACH'],
        ['detach database x', 'DETACH'],
        ["select load_extension('/tmp/evil')", 'load_extension'],
        ['pragma writable_schema = 1', 'writable_schema'],
        ['pragma trusted_schema = 1', 'trusted_schema'],
        ["vacuum into '/tmp/copy.db'", 'VACUUM INTO'],
    ])('always blocks "%s" naming %s', (sql, keyword) => {
        const result = check(sql, rw);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain(keyword);
        }
    });

    it('scrubs bracket and backtick identifiers as well as double quotes', () => {
        expect(
            scrubSql('select [drop table x], `delete from y`, "z" from t', guardProfile.scrub),
        ).toBe('select [], ``, "" from t');
    });
});

describe('sqlite identifiers', () => {
    it('double-quotes identifiers and defaults the schema to main', () => {
        expect(identifiers.quoteIdentifier('Or"ders')).toBe('"Or""ders"');
        expect(identifiers.parseObjectName('orders')).toEqual({ schema: 'main', name: 'orders' });
        expect(identifiers.parseObjectName('temp.tmp')).toEqual({ schema: 'temp', name: 'tmp' });
        expect(identifiers.qualifiedName({ schema: 'main', name: 'orders' })).toBe(
            '"main"."orders"',
        );
    });
});

describe('sqlite dialect', () => {
    it('describes itself and probes with sqlite_version()', () => {
        expect(sqliteDialect.name).toBe('sqlite');
        expect(sqliteDialect.likeEscape).toBe('backslash');
        expect(sqliteDialect.probeSql).toMatch(/sqlite_version\(\)/);
        expect(sqliteDialect.probeSql).toMatch(/as "serverTime"/);
        expect(sqliteDialect.readOnlyVariable).toBe('SQLITE_READ_ONLY');
    });
});
