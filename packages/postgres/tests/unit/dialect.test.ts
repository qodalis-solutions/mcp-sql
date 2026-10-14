import { describe, expect, it } from 'vitest';
import { scrubSql, validateSql } from '@qodalis/mcp-sql-core';
import { guardProfile, identifiers, postgresDialect } from '../../src/dialect.js';

const ro = { readOnly: true };
const rw = { readOnly: false };
const check = (sql: string, options = ro) => validateSql(sql, options, guardProfile);

describe('postgres guard profile', () => {
    it.each([
        'select * from public.customers',
        'SELECT id FROM orders ORDER BY id DESC LIMIT 10',
        'with cte as (select 1 as n) select n from cte',
        "select * from t where name = 'drop table x'",
        'select $$delete from x$$ as literal',
        'select * from t where data @> \'{"a": 1}\'::jsonb',
        'explain analyze select 1',
        'show search_path',
        'set statement_timeout = 1000; select 1',
        'select pg_sleep(0.1)',
        'select * from information_schema.tables',
        'table customers',
        'values (1), (2)',
    ])('allows read query: %s', (sql) => {
        expect(check(sql)).toEqual({ ok: true });
    });

    it.each([
        ['insert into t values (1)', 'INSERT'],
        ['update t set a = 1', 'UPDATE'],
        ['delete from t', 'DELETE'],
        ['truncate t', 'TRUNCATE'],
        ['drop table t', 'DROP'],
        ['create table t (a int)', 'CREATE'],
        ['alter table t add b int', 'ALTER'],
        ['create index i on t (a)', 'CREATE'],
        ['select * into backup from t', 'SELECT INTO'],
        ['copy t to stdout', 'COPY'],
        ["copy t from '/etc/passwd'", 'COPY'],
        ['do $$ begin perform 1; end $$', 'DO'],
        ['call do_things()', 'CALL'],
        ['grant select on t to public', 'GRANT'],
        ['vacuum t', 'VACUUM'],
        ['refresh materialized view mv', 'REFRESH MATERIALIZED VIEW'],
        ['select 1; delete from t', 'DELETE'],
        ['lock table t', 'LOCK'],
        ['listen ch', 'LISTEN'],
        ['notify ch', 'NOTIFY'],
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
        'insert into pg_temp.tmp_a values (2)',
        'update pg_temp.tmp_a set a = 3',
        'delete from pg_temp.tmp_a',
        'drop table pg_temp.tmp_a',
        'drop table if exists pg_temp.tmp_a',
        'truncate pg_temp.tmp_a',
        'select 1 into temp tmp_d',
        'select 1 into temporary table tmp_e',
    ])('allows session-local temp table work: %s', (sql) => {
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
        'do $$ begin perform 1; end $$',
        'call do_things()',
        'copy t to stdout',
    ])('allows in write mode: %s', (sql) => {
        expect(check(sql, rw)).toEqual({ ok: true });
    });

    it.each([
        ["copy t from program 'ls'", 'COPY ... PROGRAM'],
        ["select pg_read_file('/etc/passwd')", 'pg_read_file'],
        ["select pg_ls_dir('/')", 'pg_ls_dir'],
        ['select pg_terminate_backend(1)', 'pg_terminate_backend'],
        ['select pg_cancel_backend(1)', 'pg_cancel_backend'],
        ["alter system set work_mem = '1GB'", 'ALTER SYSTEM'],
        ['create role hacker login', 'CREATE ROLE'],
        ['create user hacker', 'CREATE USER'],
        ['alter role r superuser', 'ALTER ROLE'],
        ['drop database x', 'DROP DATABASE'],
        ['create database x', 'CREATE DATABASE'],
        ['create extension plpython3u', 'CREATE EXTENSION'],
        ["select dblink_connect('x')", 'dblink'],
        ['create server s foreign data wrapper postgres_fdw', 'FOREIGN DATA WRAPPER / SERVER'],
        ["select lo_import('/etc/passwd')", 'lo_import'],
        ['reindex database x', 'REINDEX'],
    ])('always blocks server-level statement "%s" naming %s', (sql, keyword) => {
        const result = check(sql, rw);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain(keyword);
        }
    });

    it('scrubs dollar-quoted bodies so keywords inside them are ignored', () => {
        expect(scrubSql('select $fn$ delete from t $fn$', guardProfile.scrub)).toBe("select ''");
    });
});

describe('postgres identifiers', () => {
    it('double-quotes identifiers and defaults the schema to public', () => {
        expect(identifiers.quoteIdentifier('Or"ders')).toBe('"Or""ders"');
        expect(identifiers.parseObjectName('orders')).toEqual({ schema: 'public', name: 'orders' });
        expect(identifiers.qualifiedName({ schema: 'sales', name: 'orders' })).toBe(
            '"sales"."orders"',
        );
    });

    it('enforces the 63 character limit', () => {
        expect(() => identifiers.quoteIdentifier('x'.repeat(64))).toThrow(/63/);
    });
});

describe('postgres dialect', () => {
    it('describes itself and probes with current_database/current_user', () => {
        expect(postgresDialect.name).toBe('postgres');
        expect(postgresDialect.probeSql).toMatch(/current_database\(\)/);
        expect(postgresDialect.probeSql).toMatch(/current_user/);
        expect(postgresDialect.readOnlyVariable).toBe('POSTGRES_READ_ONLY');
    });
});
