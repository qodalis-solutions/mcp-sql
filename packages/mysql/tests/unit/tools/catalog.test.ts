import { describe, expect, it } from 'vitest';
import { runTool } from '@qodalis/mcp-sql-core';
import {
    makeContext as makeCoreContext,
    resultText as text,
    tableResult,
} from '@qodalis/mcp-sql-core/testing';
import { mysqlDialect } from '../../../src/dialect.js';
import { describeTableTool } from '../../../src/tools/describe-table.js';
import { getForeignKeysTool } from '../../../src/tools/get-foreign-keys.js';
import { getObjectDefinitionTool } from '../../../src/tools/get-object-definition.js';
import { getServerInfoTool } from '../../../src/tools/get-server-info.js';
import { getTableStatsTool } from '../../../src/tools/get-table-stats.js';
import { listDatabasesTool } from '../../../src/tools/list-databases.js';
import { listProceduresTool } from '../../../src/tools/list-procedures.js';
import { listTablesTool } from '../../../src/tools/list-tables.js';
import { listViewsTool } from '../../../src/tools/list-views.js';
import { sampleDataTool } from '../../../src/tools/sample-data.js';
import { searchObjectsTool } from '../../../src/tools/search-objects.js';

/** The fake context has `database: 'sales'`, which doubles as the default schema on MySQL. */
const makeContext = (overrides = {}) => makeCoreContext(mysqlDialect, overrides);

describe('get_server_info', () => {
    it('reads version(), server variables and the current database', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [tableResult(['version', 'database'], [['8.4.0', 'sales']])];

        const result = await runTool(getServerInfoTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/version\(\)/);
        expect(ctx.executor.lastSql).toMatch(/@@version_comment/);
        expect(JSON.parse(text(result))).toMatchObject({ version: '8.4.0', database: 'sales' });
    });
});

describe('list_databases', () => {
    it('queries information_schema.schemata and hides the system schemas', async () => {
        const ctx = makeContext();

        await runTool(listDatabasesTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/information_schema\.schemata/);
        expect(ctx.executor.lastSql).toMatch(/performance_schema/);
    });
});

describe('list_tables', () => {
    it('lists base tables with row estimates, engine and size for the current database', async () => {
        const ctx = makeContext();

        await runTool(listTablesTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/information_schema\.tables/);
        expect(ctx.executor.lastSql).toMatch(/table_type = 'BASE TABLE'/);
        expect(ctx.executor.lastSql).toMatch(/table_rows/);
        expect(ctx.executor.lastSql).toMatch(/coalesce\(@schema, database\(\)\)/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'Sales' });
    });

    it('applies schema and name filters as parameters with backslash LIKE escaping and no escape clause', async () => {
        const ctx = makeContext();

        await runTool(listTablesTool, { schema: 'other', nameContains: 'ord_er' }, ctx);

        expect(ctx.executor.lastParams).toMatchObject({
            schema: 'other',
            namePattern: '%ord\\_er%',
        });
        expect(ctx.executor.lastSql).not.toMatch(/escape/i);
    });

    it('falls back to database() when no database is configured', async () => {
        const ctx = makeContext({ config: { database: undefined } });

        await runTool(listTablesTool, {}, ctx);

        expect(ctx.executor.lastParams).toMatchObject({ schema: null });
    });
});

describe('list_views', () => {
    it('lists views from information_schema.tables', async () => {
        const ctx = makeContext();

        await runTool(listViewsTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/table_type = 'VIEW'/);
    });
});

describe('list_procedures', () => {
    it('lists routines by kind', async () => {
        const ctx = makeContext();

        await runTool(listProceduresTool, { kind: 'procedure' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/information_schema\.routines/);
        expect(ctx.executor.lastSql).not.toMatch(/routine_definition/);
        expect(ctx.executor.lastParams).toMatchObject({ kind: 'PROCEDURE' });
    });
});

describe('describe_table', () => {
    it('returns columns, indexes and foreign keys from information_schema', async () => {
        const ctx = makeContext();
        ctx.executor.resolver = (options) => {
            if (/referential_constraints/.test(options.sql)) {
                return tableResult(['name'], [['orders_customer_fk']]);
            }
            if (/information_schema\.statistics/.test(options.sql)) {
                return tableResult(['name', 'is_primary_key'], [['PRIMARY', true]]);
            }
            if (/information_schema\.columns/.test(options.sql)) {
                return tableResult(['name', 'type'], [['id', 'int']]);
            }
            return tableResult([], []);
        };

        const result = await runTool(describeTableTool, { table: 'shop.orders' }, ctx);
        const parsed = JSON.parse(text(result));

        expect(parsed.table).toBe('shop.orders');
        expect(parsed.columns).toEqual([{ name: 'id', type: 'int' }]);
        expect(parsed.indexes).toEqual([{ name: 'PRIMARY', is_primary_key: true }]);
        expect(parsed.foreignKeys).toEqual([{ name: 'orders_customer_fk' }]);
        expect(
            ctx.executor.calls.every(
                (c) => c.params?.schema === 'shop' && c.params?.table === 'orders',
            ),
        ).toBe(true);
    });

    it('defaults the schema to the configured database and reports a missing table clearly', async () => {
        const ctx = makeContext();

        const result = await runTool(describeTableTool, { table: 'nope' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/Sales\.nope.*not found/i);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'Sales', table: 'nope' });
    });
});

describe('get_foreign_keys', () => {
    it('scopes to a table on either side when given', async () => {
        const ctx = makeContext();

        await runTool(getForeignKeysTool, { table: 'orders' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/referenced_table_name/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'Sales', table: 'orders' });
    });

    it('lists the whole database otherwise', async () => {
        const ctx = makeContext();

        await runTool(getForeignKeysTool, {}, ctx);

        expect(ctx.executor.lastParams).not.toHaveProperty('table');
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'Sales' });
    });
});

describe('get_table_stats', () => {
    it('reads row estimates and data/index sizes for one table', async () => {
        const ctx = makeContext();

        await runTool(getTableStatsTool, { table: 'orders' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/data_length/);
        expect(ctx.executor.lastSql).toMatch(/index_length/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'Sales', table: 'orders' });
    });

    it('returns the largest tables when no table is given', async () => {
        const ctx = makeContext();

        await runTool(getTableStatsTool, { top: 5 }, ctx);

        expect(ctx.executor.lastParams).toMatchObject({ top: 5 });
        expect(ctx.executor.lastSql).toMatch(/limit @top/);
    });
});

describe('get_object_definition', () => {
    it('fetches view, routine and trigger definitions', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [tableResult(['type', 'definition'], [['view', 'select 1']])];

        const result = await runTool(getObjectDefinitionTool, { name: 'v' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/view_definition/);
        expect(ctx.executor.lastSql).toMatch(/routine_definition/);
        expect(ctx.executor.lastSql).toMatch(/action_statement/);
        expect(text(result)).toContain('select 1');
    });

    it('explains when nothing is found', async () => {
        const ctx = makeContext();

        const result = await runTool(getObjectDefinitionTool, { name: 'nope' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/not found/i);
    });

    it('explains when the definition is hidden by privileges', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [tableResult(['type', 'definition'], [['view', null]])];

        const result = await runTool(getObjectDefinitionTool, { name: 'v' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/SHOW VIEW/);
    });
});

describe('search_objects', () => {
    it('searches tables, views, routines and columns across user databases', async () => {
        const ctx = makeContext();

        await runTool(searchObjectsTool, { pattern: 'cust' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/information_schema\.columns/);
        expect(ctx.executor.lastSql).toMatch(/information_schema\.routines/);
        expect(ctx.executor.lastParams).toMatchObject({ pattern: '%cust%' });
    });

    it('narrows to the requested types and honours the limit', async () => {
        const ctx = makeContext();

        await runTool(searchObjectsTool, { pattern: 'x', types: ['table'], limit: 7 }, ctx);

        expect(ctx.executor.lastSql).not.toMatch(/information_schema\.columns/);
        expect(ctx.executor.lastSql).not.toMatch(/information_schema\.routines/);
        expect(ctx.executor.calls[0]?.maxRows).toBe(7);
    });
});

describe('sample_data', () => {
    it('selects with LIMIT from a backtick-quoted, database-qualified table name', async () => {
        const ctx = makeContext();

        await runTool(sampleDataTool, { table: 'shop.or`ders' }, ctx);

        expect(ctx.executor.lastSql).toBe('select * from `shop`.`or``ders` limit @limit');
        expect(ctx.executor.lastParams).toMatchObject({ limit: 10 });
    });

    it('supports random sampling and a column subset, defaulting to the configured database', async () => {
        const ctx = makeContext();

        await runTool(
            sampleDataTool,
            { table: 't', columns: ['id', 'na`me'], random: true, limit: 3 },
            ctx,
        );

        expect(ctx.executor.lastSql).toBe(
            'select `id`, `na``me` from `Sales`.`t` order by rand() limit @limit',
        );
        expect(ctx.executor.lastParams).toMatchObject({ limit: 3 });
    });

    it('leaves the table unqualified when no database is configured or given', async () => {
        const ctx = makeContext({ config: { database: undefined } });

        await runTool(sampleDataTool, { table: 't' }, ctx);

        expect(ctx.executor.lastSql).toBe('select * from `t` limit @limit');
    });
});
