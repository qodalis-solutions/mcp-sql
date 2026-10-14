import { describe, expect, it } from 'vitest';
import { scrubSql, validateSql } from '../../src/sql/guard.js';

const readOnly = { readOnly: true };
const writable = { readOnly: false };

describe('scrubSql', () => {
    it('blanks string literals so keywords inside them are ignored', () => {
        expect(scrubSql("select 'drop table x' as t")).toBe("select '' as t");
    });

    it('handles escaped quotes inside string literals', () => {
        expect(scrubSql("select 'it''s a delete' as t")).toBe("select '' as t");
    });

    it('removes line and block comments', () => {
        expect(scrubSql('select 1 -- delete from x\n/* truncate table y */ + 2')).toBe(
            'select 1 \n + 2',
        );
    });

    it('blanks bracketed and double-quoted identifiers', () => {
        expect(scrubSql('select [drop], "update" from t')).toBe('select [], "" from t');
    });
});

describe('validateSql in read-only mode', () => {
    it.each([
        'select * from dbo.Customers',
        'SELECT TOP 10 Id FROM Orders ORDER BY Id DESC',
        'with cte as (select 1 as n) select n from cte',
        "select * from t where name = 'drop table x'",
        'declare @id int = 5; select @id',
        'set nocount on; select 1',
        'select count(*) from sys.tables',
        'select * from t option (maxdop 1)',
    ])('allows read query: %s', (sql) => {
        expect(validateSql(sql, readOnly)).toEqual({ ok: true });
    });

    it.each([
        ['insert into dbo.T values (1)', 'INSERT'],
        ['update T set a = 1', 'UPDATE'],
        ['delete from T', 'DELETE'],
        ['delete T where 1=1', 'DELETE'],
        ['merge T using S on 1=1 when matched then delete;', 'MERGE'],
        ['truncate table T', 'TRUNCATE'],
        ['drop table T', 'DROP'],
        ['create table T (a int)', 'CREATE'],
        ['alter table T add b int', 'ALTER'],
        ['select * into Backup from T', 'SELECT INTO'],
        ['exec dbo.DoThing', 'EXEC'],
        ["execute sp_executesql N'select 1'", 'EXEC'],
        ['select 1; dbcc checkdb', 'DBCC'],
        ['insert into ##global values (1)', 'INSERT'],
        ["waitfor delay '00:00:10'; select 1", 'WAITFOR'],
        ["select * from openrowset(bulk 'x', single_blob) as t", 'OPENROWSET'],
        ['grant select on T to public', 'GRANT'],
    ])('rejects "%s" naming %s', (sql, keyword) => {
        const result = validateSql(sql, readOnly);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain(keyword);
        }
    });

    it.each([
        'create table #tmp (a int); insert into #tmp values (1); select * from #tmp',
        'select Id into #ids from T; select * from #ids',
        'declare @t table (a int); insert @t values (1); select * from @t',
        'update #tmp set a = 2',
        'delete from #tmp where a = 1',
        'truncate table #tmp',
        'drop table #tmp',
        'drop table if exists #tmp',
        'insert into #tmp (a) select 1',
    ])('allows session-local temp table work: %s', (sql) => {
        expect(validateSql(sql, readOnly)).toEqual({ ok: true });
    });

    it('rejects an empty query', () => {
        expect(validateSql('   ', readOnly).ok).toBe(false);
    });

    it('rejects multi-statement batches that mix a read with a hidden write', () => {
        const result = validateSql('select 1; /* comment */ delete from T', readOnly);
        expect(result.ok).toBe(false);
    });
});

describe('validateSql in write mode', () => {
    it.each(['insert into T values (1)', 'update T set a = 1', 'delete from T', 'exec dbo.P'])(
        'allows data changes: %s',
        (sql) => {
            expect(validateSql(sql, writable)).toEqual({ ok: true });
        },
    );

    it.each([
        ["exec xp_cmdshell 'dir'", 'xp_cmdshell'],
        ["exec sp_configure 'show advanced options', 1", 'sp_configure'],
        ['shutdown', 'SHUTDOWN'],
        ['kill 53', 'KILL'],
        ["restore database X from disk = 'x'", 'RESTORE'],
        ["backup database X to disk = 'x'", 'BACKUP'],
        ['drop database X', 'DROP DATABASE'],
        ['alter database X set single_user', 'ALTER DATABASE'],
        ["create login hacker with password = 'x'", 'CREATE LOGIN'],
        ["bulk insert T from 'c:\\x'", 'BULK INSERT'],
        ["select * from opendatasource('SQLNCLI', 'x').db.dbo.t", 'OPENDATASOURCE'],
        ['reconfigure', 'RECONFIGURE'],
    ])('always blocks server-level statement "%s" naming %s', (sql, keyword) => {
        const result = validateSql(sql, writable);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain(keyword);
        }
    });
});
