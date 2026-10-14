import { describe, expect, it } from 'vitest';
import { scrubSql, validateSql } from '@qodalis/mcp-sql-core';
import { guardProfile, identifiers, mysqlDialect } from '../../src/dialect.js';

const ro = { readOnly: true };
const rw = { readOnly: false };
const check = (sql: string, options = ro) => validateSql(sql, options, guardProfile);

describe('mysql guard profile', () => {
    it.each([
        'select * from sales.customers',
        'SELECT id FROM orders ORDER BY id DESC LIMIT 10',
        'with cte as (select 1 as n) select n from cte',
        "select * from t where name = 'drop table x'",
        'select `drop table x` from t',
        'select * from t # delete from t',
        'select * from t -- delete from t',
        'explain select 1',
        'show tables',
        'show create table t',
        'describe t',
        'set @x = 1; select @x',
        'set session sql_mode = ansi; select 1',
        'select @@version',
        'select * from information_schema.tables',
        'start transaction; select 1; rollback',
        'select json_extract(data, "$.a") from t',
    ])('allows read query: %s', (sql) => {
        expect(check(sql)).toEqual({ ok: true });
    });

    it.each([
        ['insert into t values (1)', 'INSERT'],
        ['update t set a = 1', 'UPDATE'],
        ['delete from t', 'DELETE'],
        ['truncate t', 'TRUNCATE'],
        ['truncate table t', 'TRUNCATE'],
        ['drop table t', 'DROP'],
        ['create table t (a int)', 'CREATE'],
        ['alter table t add b int', 'ALTER'],
        ['create index i on t (a)', 'CREATE'],
        ['create view v as select 1', 'CREATE'],
        ['drop view v', 'DROP'],
        ['rename table t to u', 'RENAME'],
        ['replace into t values (1)', 'REPLACE'],
        ['call do_things()', 'CALL'],
        ['do sleep(1)', 'DO'],
        ['lock tables t write', 'LOCK'],
        ['optimize table t', 'OPTIMIZE'],
        ['analyze table t', 'ANALYZE'],
        ['select 1; delete from t', 'DELETE'],
        ['handler t open', 'HANDLER'],
    ])('rejects "%s" naming %s', (sql, keyword) => {
        const result = check(sql);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain(keyword);
        }
    });

    it.each([
        'create temporary table tmp_a (a int); insert into tmp_a values (1); select * from tmp_a',
        'create temporary table tmp_b as select 1 as n',
        'create temporary table if not exists tmp_c (a int)',
        'create temporary table tmp_d (a int); update tmp_d set a = 2; delete from tmp_d; truncate tmp_d',
        'create temporary table tmp_e (a int); drop temporary table tmp_e',
        'create temporary table tmp_f (a int); drop table if exists tmp_f',
    ])('allows session-local temporary table work: %s', (sql) => {
        expect(check(sql)).toEqual({ ok: true });
    });

    it('rejects a write to a table that merely looks temporary', () => {
        expect(check('insert into tmp_looks_temp values (1)').ok).toBe(false);
    });

    it.each([
        'insert into t values (1)',
        'update t set a = 1',
        'delete from t',
        'create table t (a int)',
        'call do_things()',
        'replace into t values (1)',
        'alter table t add b int',
    ])('allows in write mode: %s', (sql) => {
        expect(check(sql, rw)).toEqual({ ok: true });
    });

    it.each([
        ["load data infile '/etc/passwd' into table t", 'LOAD DATA'],
        ["select * from t into outfile '/tmp/x'", 'INTO OUTFILE'],
        ["select * from t into dumpfile '/tmp/x'", 'INTO OUTFILE'],
        ["select load_file('/etc/passwd')", 'LOAD_FILE'],
        ["create user 'h'@'%' identified by 'x'", 'CREATE USER'],
        ["alter user 'h'@'%' identified by 'x'", 'ALTER USER'],
        ["drop user 'h'@'%'", 'DROP USER'],
        ['grant all on *.* to h', 'GRANT'],
        ['revoke all on *.* from h', 'REVOKE'],
        ['set global max_connections = 1', 'SET GLOBAL'],
        ['set persist max_connections = 1', 'SET GLOBAL'],
        ["install plugin x soname 'x.so'", 'INSTALL'],
        ['uninstall component x', 'INSTALL'],
        ['shutdown', 'SHUTDOWN'],
        ['kill 42', 'KILL'],
        ['kill connection 42', 'KILL'],
        ['reset master', 'RESET'],
        ["purge binary logs to 'x'", 'PURGE'],
        ["change replication source to source_host = 'x'", 'REPLICATION'],
        ['start replica', 'REPLICATION'],
        ['stop slave', 'REPLICATION'],
        ['flush privileges', 'FLUSH'],
        ['use other_db', 'USE'],
    ])('always blocks server-level statement "%s" naming %s', (sql, keyword) => {
        const result = check(sql, rw);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain(keyword);
        }
    });

    it('scrubs # comments and backtick identifiers', () => {
        expect(scrubSql('select `x` from t # drop table t', guardProfile.scrub)).toBe(
            'select `` from t ',
        );
    });
});

describe('mysql identifiers', () => {
    it('backtick-quotes identifiers and has no fixed default schema', () => {
        expect(identifiers.quoteIdentifier('Or`ders')).toBe('`Or``ders`');
        expect(identifiers.parseObjectName('orders')).toEqual({ schema: '', name: 'orders' });
        expect(identifiers.parseObjectName('orders', 'sales')).toEqual({
            schema: 'sales',
            name: 'orders',
        });
        expect(identifiers.qualifiedName({ schema: 'sales', name: 'orders' })).toBe(
            '`sales`.`orders`',
        );
    });

    it('enforces the 64 character limit', () => {
        expect(() => identifiers.quoteIdentifier('x'.repeat(65))).toThrow(/64/);
    });
});

describe('mysql dialect', () => {
    it('describes itself and probes with database()/current_user()', () => {
        expect(mysqlDialect.name).toBe('mysql');
        expect(mysqlDialect.displayName).toMatch(/MySQL/);
        expect(mysqlDialect.likeEscape).toBe('backslash');
        expect(mysqlDialect.probeSql).toMatch(/database\(\)/);
        expect(mysqlDialect.probeSql).toMatch(/current_user\(\)/);
        expect(mysqlDialect.readOnlyVariable).toBe('MYSQL_READ_ONLY');
    });
});
