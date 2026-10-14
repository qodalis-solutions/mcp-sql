import { describe, expect, it } from 'vitest';
import { validateSql } from '@qodalis/mcp-sql-core';
import { guardProfile, identifiers, oracleDialect } from '../../src/dialect.js';

const ro = { readOnly: true };
const rw = { readOnly: false };
const check = (sql: string, options = ro) => validateSql(sql, options, guardProfile);

describe('oracle guard profile', () => {
    it.each([
        'select * from hr.employees',
        'SELECT id FROM orders ORDER BY id DESC FETCH FIRST 10 ROWS ONLY',
        'with cte as (select 1 as n from dual) select n from cte',
        "select * from t where name = 'drop table x'",
        "select q'[delete from t]' from dual",
        'select sysdate from dual',
        'select * from all_tables where owner = user',
        'alter session set current_schema = hr',
        "alter session set nls_date_format = 'YYYY-MM-DD'",
        'rollback',
        'select * from table(dbms_xplan.display)',
        'explain plan for select 1 from dual',
    ])('allows read query: %s', (sql) => {
        expect(check(sql)).toEqual({ ok: true });
    });

    it.each([
        ['insert into t values (1)', 'INSERT'],
        ['update t set a = 1', 'UPDATE'],
        ['delete from t', 'DELETE'],
        ['delete t', 'DELETE'],
        ['truncate table t', 'TRUNCATE'],
        ['drop table t', 'DROP'],
        ['create table t (a number)', 'CREATE'],
        ['create global temporary table ora$ptt_gt (a number)', 'CREATE'],
        ['create index i on t (a)', 'CREATE'],
        ['alter table t add b number', 'ALTER'],
        ['begin null; end;', 'PL/SQL'],
        ['declare x number; begin x := 1; end;', 'PL/SQL'],
        ['call do_things()', 'CALL'],
        ['exec do_things', 'EXEC'],
        ['merge into t using s on (t.id = s.id) when matched then update set t.a = s.a', 'MERGE'],
        ["comment on table t is 'x'", 'COMMENT ON'],
        ['lock table t in exclusive mode', 'LOCK TABLE'],
        ['purge recyclebin', 'PURGE'],
        ['flashback table t to before drop', 'FLASHBACK'],
        ['analyze table t compute statistics', 'ANALYZE'],
        ['rename t to u', 'RENAME'],
        ['select 1 from dual; delete from t', 'DELETE'],
        ['commit', 'COMMIT'],
        ['create sequence s', 'CREATE'],
        ['drop sequence s', 'DROP'],
    ])('rejects "%s" naming %s', (sql, keyword) => {
        const result = check(sql);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain(keyword);
        }
    });

    it.each([
        'create private temporary table ora$ptt_a as select 1 as n from dual',
        'create private temporary table ora$ptt_b (a number) on commit preserve definition',
        'insert into ora$ptt_a values (2)',
        'update ora$ptt_a set n = 3',
        'delete from ora$ptt_a',
        'drop table ora$ptt_a',
        'truncate table ora$ptt_a',
        'create private temporary table ora$ptt_c as select 1 as n from dual; insert into ora$ptt_c values (2); select * from ora$ptt_c',
    ])('allows session-local private temporary table work: %s', (sql) => {
        expect(check(sql)).toEqual({ ok: true });
    });

    it('rejects writes to tables that merely look temporary', () => {
        expect(check('insert into tmp_looks_temp values (1)').ok).toBe(false);
        expect(check('insert into gtt_orders values (1)').ok).toBe(false);
    });

    it.each([
        'insert into t values (1)',
        'update t set a = 1',
        'delete from t',
        'create table t (a number)',
        'begin null; end;',
        'call do_things()',
        'merge into t using s on (t.id = s.id) when matched then update set t.a = s.a',
        'commit',
    ])('allows in write mode: %s', (sql) => {
        expect(check(sql, rw)).toEqual({ ok: true });
    });

    it.each([
        ["begin dbms_scheduler.create_job('j'); end;", 'DBMS_SCHEDULER'],
        ["select utl_file.fopen('d', 'f', 'r') from dual", 'UTL_FILE'],
        ["select utl_http.request('http://x') from dual", 'UTL_HTTP'],
        ['begin utl_tcp.open_connection(1); end;', 'UTL_TCP'],
        ['create user hacker identified by x', 'USER, ROLE, PROFILE'],
        ['alter user hr identified by x', 'USER, ROLE, PROFILE'],
        ['drop role r', 'USER, ROLE, PROFILE'],
        ['create database link l connect to u identified by p using x', 'DATABASE LINK'],
        ["create directory d as '/tmp'", 'DIRECTORY'],
        ['create tablespace ts', 'TABLESPACE'],
        ['alter system set x = 1', 'ALTER SYSTEM'],
        ['alter database open', 'ALTER DATABASE'],
        ["alter session set events '10046'", 'ALTER SESSION'],
        ['grant dba to hacker', 'GRANT'],
        ['revoke select on t from u', 'REVOKE'],
        ['audit all', 'AUDIT'],
        ['shutdown immediate', 'SHUTDOWN'],
        ["alter system kill session '1,2'", 'ALTER SYSTEM'],
        ["begin execute immediate 'drop table t'; end;", 'EXECUTE IMMEDIATE'],
        ['begin dbms_sql.parse(1, 2, 3); end;', 'DBMS_SQL'],
    ])('always blocks server-level statement "%s" naming %s', (sql, keyword) => {
        const result = check(sql, rw);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain(keyword);
        }
    });
});

describe('oracle identifiers', () => {
    it('double-quotes identifiers and upper-cases unquoted names', () => {
        expect(identifiers.quoteIdentifier('Or"ders')).toBe('"Or""ders"');
        expect(identifiers.parseObjectName('orders', 'hr')).toEqual({
            schema: 'HR',
            name: 'ORDERS',
        });
        expect(identifiers.parseObjectName('sales.orders')).toEqual({
            schema: 'SALES',
            name: 'ORDERS',
        });
        expect(identifiers.parseObjectName('"Sales"."my.table"')).toEqual({
            schema: 'Sales',
            name: 'my.table',
        });
        expect(identifiers.qualifiedName({ schema: 'HR', name: 'EMP' })).toBe('"HR"."EMP"');
    });

    it('needs a schema from somewhere and rejects database links', () => {
        expect(() => identifiers.parseObjectName('orders')).toThrow(/schema/);
        expect(() => identifiers.parseObjectName('a.b.c')).toThrow(/schema\.name/);
    });

    it('enforces the 128 character limit', () => {
        expect(() => identifiers.quoteIdentifier('x'.repeat(129))).toThrow(/128/);
    });
});

describe('oracle dialect', () => {
    it('describes itself and probes from dual', () => {
        expect(oracleDialect.name).toBe('oracle');
        expect(oracleDialect.probeSql).toMatch(/from dual/);
        expect(oracleDialect.probeSql).toMatch(/"database"/);
        expect(oracleDialect.readOnlyVariable).toBe('ORACLE_READ_ONLY');
        expect(oracleDialect.likeEscape).toBe('backslash');
    });
});
