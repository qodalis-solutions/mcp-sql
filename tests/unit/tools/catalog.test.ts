import { describe, expect, it } from 'vitest';
import { runTool } from '../../../src/tools/context.js';
import { listDatabasesTool } from '../../../src/tools/list-databases.js';
import { listTablesTool } from '../../../src/tools/list-tables.js';
import { listViewsTool } from '../../../src/tools/list-views.js';
import { listProceduresTool } from '../../../src/tools/list-procedures.js';
import { describeTableTool } from '../../../src/tools/describe-table.js';
import { getForeignKeysTool } from '../../../src/tools/get-foreign-keys.js';
import { getTableStatsTool } from '../../../src/tools/get-table-stats.js';
import { getObjectDefinitionTool } from '../../../src/tools/get-object-definition.js';
import { searchObjectsTool } from '../../../src/tools/search-objects.js';
import { sampleDataTool } from '../../../src/tools/sample-data.js';
import { makeContext, tableResult } from '../../helpers/fake-executor.js';

const text = (result: { content: unknown[] }): string =>
    (result.content[0] as { text: string }).text;

describe('list_databases', () => {
    it('queries sys.databases and returns name and state', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [tableResult(['name', 'state'], [['Sales', 'ONLINE']])];

        const result = await runTool(listDatabasesTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/sys\.databases/);
        expect(JSON.parse(text(result)).rows).toEqual([['Sales', 'ONLINE']]);
    });
});

describe('list_tables', () => {
    it('lists user tables with row counts by default', async () => {
        const ctx = makeContext();

        await runTool(listTablesTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/sys\.tables/);
        expect(ctx.executor.lastSql).toMatch(/sys\.partitions/);
        expect(ctx.executor.lastSql).not.toMatch(/dm_db_partition_stats/);
    });

    it('applies schema and name filters as parameters, never by string concatenation', async () => {
        const ctx = makeContext();

        await runTool(listTablesTool, { schema: 'sales', nameContains: "Ord'er" }, ctx);

        expect(ctx.executor.lastParams).toMatchObject({ schema: 'sales', namePattern: "%Ord'er%" });
        expect(ctx.executor.lastSql).not.toContain("Ord'er");
    });

    it('can skip the row-count join for speed', async () => {
        const ctx = makeContext();

        await runTool(listTablesTool, { includeRowCounts: false }, ctx);

        expect(ctx.executor.lastSql).not.toMatch(/sys\.partitions/);
    });
});

describe('list_views', () => {
    it('queries sys.views with optional filters', async () => {
        const ctx = makeContext();

        await runTool(listViewsTool, { schema: 'dbo' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/sys\.views/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'dbo' });
    });
});

describe('list_procedures', () => {
    it('lists procedures and functions by kind', async () => {
        const ctx = makeContext();

        await runTool(listProceduresTool, { kind: 'function' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/sys\.objects/);
        expect(ctx.executor.lastParams).toMatchObject({ kind: 'function' });
    });
});

describe('describe_table', () => {
    it('returns columns, primary key, indexes and foreign keys for the table', async () => {
        const ctx = makeContext();
        ctx.executor.resolver = (options) => {
            if (/from sys\.foreign_keys/.test(options.sql)) {
                return tableResult(['name'], [['FK_T_U']]);
            }
            if (/from sys\.indexes/.test(options.sql)) {
                return tableResult(['name', 'is_primary_key'], [['PK_T', true]]);
            }
            if (/from sys\.columns/.test(options.sql)) {
                return tableResult(['name', 'type'], [['Id', 'int']]);
            }
            return tableResult([], []);
        };

        const result = await runTool(describeTableTool, { table: 'sales.T' }, ctx);
        const parsed = JSON.parse(text(result));

        expect(parsed.table).toBe('sales.T');
        expect(parsed.columns).toEqual([{ name: 'Id', type: 'int' }]);
        expect(parsed.indexes).toEqual([{ name: 'PK_T', is_primary_key: true }]);
        expect(parsed.foreignKeys).toEqual([{ name: 'FK_T_U' }]);
        expect(
            ctx.executor.calls.every(
                (c) => c.params?.schema === 'sales' && c.params?.table === 'T',
            ),
        ).toBe(true);
    });

    it('reports a missing table clearly', async () => {
        const ctx = makeContext();

        const result = await runTool(describeTableTool, { table: 'Nope' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/dbo\.Nope.*not found/i);
    });
});

describe('get_foreign_keys', () => {
    it('lists relationships touching a table in either direction', async () => {
        const ctx = makeContext();

        await runTool(getForeignKeysTool, { table: 'dbo.Orders' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/sys\.foreign_keys/);
        expect(ctx.executor.lastSql).toMatch(/referenced_object_id/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'dbo', table: 'Orders' });
    });

    it('lists every relationship in the database when no table is given', async () => {
        const ctx = makeContext();

        await runTool(getForeignKeysTool, {}, ctx);

        expect(ctx.executor.lastParams).not.toHaveProperty('table');
    });
});

describe('get_table_stats', () => {
    it('returns size and row statistics for one table', async () => {
        const ctx = makeContext();

        await runTool(getTableStatsTool, { table: 'Orders' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/sys\.allocation_units/);
        expect(ctx.executor.lastSql).not.toMatch(/dm_db_partition_stats/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'dbo', table: 'Orders' });
    });

    it('returns the largest tables when no table is given', async () => {
        const ctx = makeContext();

        await runTool(getTableStatsTool, { top: 5 }, ctx);

        expect(ctx.executor.lastParams).toMatchObject({ top: 5 });
    });
});

describe('get_object_definition', () => {
    it('fetches the T-SQL source of a view, procedure or function', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [
            tableResult(['definition', 'type_desc'], [['create view v as select 1', 'VIEW']]),
        ];

        const result = await runTool(getObjectDefinitionTool, { name: 'dbo.v' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/OBJECT_DEFINITION|sql_modules/);
        expect(text(result)).toContain('create view v as select 1');
    });

    it('explains that VIEW DEFINITION permission is missing when a module has a null definition', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [tableResult(['type', 'definition'], [['VIEW', null]])];

        const result = await runTool(getObjectDefinitionTool, { name: 'dbo.v' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/VIEW DEFINITION/);
        expect(text(result)).toMatch(/encrypted/i);
    });

    it('says a table has no definition to show', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [tableResult(['type', 'definition'], [['USER_TABLE', null]])];

        const result = await runTool(getObjectDefinitionTool, { name: 'dbo.T' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/USER_TABLE/);
        expect(text(result)).toMatch(/describe_table/);
    });

    it('explains when the object has no definition', async () => {
        const ctx = makeContext();

        const result = await runTool(getObjectDefinitionTool, { name: 'dbo.T' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/no definition|not found/i);
    });
});

describe('search_objects', () => {
    it('searches tables, views, routines and columns by pattern', async () => {
        const ctx = makeContext();

        await runTool(searchObjectsTool, { pattern: 'cust' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/sys\.columns/);
        expect(ctx.executor.lastParams).toMatchObject({ pattern: '%cust%' });
    });

    it('narrows to the requested object types and honours the limit', async () => {
        const ctx = makeContext();

        await runTool(searchObjectsTool, { pattern: 'x', types: ['table'], limit: 7 }, ctx);

        expect(ctx.executor.lastSql).not.toMatch(/sys\.columns/);
        expect(ctx.executor.calls[0]?.maxRows).toBe(7);
    });
});

describe('sample_data', () => {
    it('selects the first rows from a quoted table name', async () => {
        const ctx = makeContext();

        await runTool(sampleDataTool, { table: 'sales.Or]ders' }, ctx);

        expect(ctx.executor.lastSql).toContain('select top (@limit) * from [sales].[Or]]ders]');
        expect(ctx.executor.lastParams).toMatchObject({ limit: 10 });
    });

    it('supports random sampling and a column subset', async () => {
        const ctx = makeContext();

        await runTool(
            sampleDataTool,
            { table: 'T', columns: ['Id', 'Na]me'], random: true, limit: 3 },
            ctx,
        );

        expect(ctx.executor.lastSql).toContain('select top (@limit) [Id], [Na]]me] from [dbo].[T]');
        expect(ctx.executor.lastSql).toMatch(/order by newid\(\)/i);
        expect(ctx.executor.lastParams).toMatchObject({ limit: 3 });
    });
});
