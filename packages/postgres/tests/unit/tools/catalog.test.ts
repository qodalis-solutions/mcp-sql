import { describe, expect, it } from 'vitest';
import { runTool } from '@qodalis/mcp-sql-core';
import {
    makeContext as makeCoreContext,
    resultText as text,
    tableResult,
} from '@qodalis/mcp-sql-core/testing';
import { postgresDialect } from '../../../src/dialect.js';
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

const makeContext = (overrides = {}) => makeCoreContext(postgresDialect, overrides);

describe('get_server_info', () => {
    it('reads version(), server settings and the current database', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [tableResult(['serverVersion', 'database'], [['17.2', 'sales']])];

        const result = await runTool(getServerInfoTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/version\(\)/);
        expect(ctx.executor.lastSql).toMatch(/server_version/);
        expect(JSON.parse(text(result))).toMatchObject({
            serverVersion: '17.2',
            database: 'sales',
        });
    });
});

describe('list_databases', () => {
    it('queries pg_database and skips templates', async () => {
        const ctx = makeContext();

        await runTool(listDatabasesTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/pg_database/);
        expect(ctx.executor.lastSql).toMatch(/datistemplate/);
    });
});

describe('list_tables', () => {
    it('lists ordinary and partitioned tables with live row estimates', async () => {
        const ctx = makeContext();

        await runTool(listTablesTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/pg_class/);
        expect(ctx.executor.lastSql).toMatch(/relkind in \('r', 'p'\)/);
        expect(ctx.executor.lastSql).toMatch(/n_live_tup/);
    });

    it('applies schema and name filters as parameters with backslash LIKE escaping', async () => {
        const ctx = makeContext();

        await runTool(listTablesTool, { schema: 'sales', nameContains: 'ord_er' }, ctx);

        expect(ctx.executor.lastParams).toMatchObject({
            schema: 'sales',
            namePattern: '%ord\\_er%',
        });
        expect(ctx.executor.lastSql).toMatch(/escape '\\'/i);
    });

    it('hides system schemas unless a schema is given', async () => {
        const ctx = makeContext();

        await runTool(listTablesTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/pg_catalog/);
        expect(ctx.executor.lastSql).toMatch(/information_schema/);
    });
});

describe('list_views', () => {
    it('lists views and materialized views', async () => {
        const ctx = makeContext();

        await runTool(listViewsTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/relkind in \('v', 'm'\)/);
    });
});

describe('list_procedures', () => {
    it('lists functions and procedures from pg_proc by kind', async () => {
        const ctx = makeContext();

        await runTool(listProceduresTool, { kind: 'procedure' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/pg_proc/);
        expect(ctx.executor.lastParams).toMatchObject({ kind: 'procedure' });
    });
});

describe('describe_table', () => {
    it('returns columns, indexes and foreign keys using the catalog', async () => {
        const ctx = makeContext();
        ctx.executor.resolver = (options) => {
            if (/from pg_constraint/.test(options.sql)) {
                return tableResult(['name'], [['orders_customer_fk']]);
            }
            if (/from pg_index/.test(options.sql)) {
                return tableResult(['name', 'is_primary_key'], [['orders_pkey', true]]);
            }
            if (/from pg_attribute/.test(options.sql)) {
                return tableResult(['name', 'type'], [['id', 'integer']]);
            }
            return tableResult([], []);
        };

        const result = await runTool(describeTableTool, { table: 'sales.orders' }, ctx);
        const parsed = JSON.parse(text(result));

        expect(parsed.table).toBe('sales.orders');
        expect(parsed.columns).toEqual([{ name: 'id', type: 'integer' }]);
        expect(parsed.indexes).toEqual([{ name: 'orders_pkey', is_primary_key: true }]);
        expect(parsed.foreignKeys).toEqual([{ name: 'orders_customer_fk' }]);
        expect(
            ctx.executor.calls.every(
                (c) => c.params?.schema === 'sales' && c.params?.table === 'orders',
            ),
        ).toBe(true);
    });

    it('reports a missing table clearly', async () => {
        const ctx = makeContext();

        const result = await runTool(describeTableTool, { table: 'nope' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/public\.nope.*not found/i);
    });
});

describe('get_foreign_keys', () => {
    it('scopes to a table on either side when given', async () => {
        const ctx = makeContext();

        await runTool(getForeignKeysTool, { table: 'orders' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/pg_constraint/);
        expect(ctx.executor.lastSql).toMatch(/confrelid/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'public', table: 'orders' });
    });

    it('lists the whole database otherwise', async () => {
        const ctx = makeContext();

        await runTool(getForeignKeysTool, {}, ctx);

        expect(ctx.executor.lastParams).not.toHaveProperty('table');
    });
});

describe('get_table_stats', () => {
    it('uses pg_total_relation_size and pg_stat_user_tables', async () => {
        const ctx = makeContext();

        await runTool(getTableStatsTool, { table: 'orders' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/pg_total_relation_size/);
        expect(ctx.executor.lastSql).toMatch(/n_dead_tup/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'public', table: 'orders' });
    });

    it('returns the largest tables when no table is given', async () => {
        const ctx = makeContext();

        await runTool(getTableStatsTool, { top: 5 }, ctx);

        expect(ctx.executor.lastParams).toMatchObject({ top: 5 });
    });
});

describe('get_object_definition', () => {
    it('fetches view, function and trigger definitions', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [tableResult(['type', 'definition'], [['view', 'SELECT 1']])];

        const result = await runTool(getObjectDefinitionTool, { name: 'public.v' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/pg_get_viewdef|pg_get_functiondef/);
        expect(text(result)).toContain('SELECT 1');
    });

    it('explains when nothing is found', async () => {
        const ctx = makeContext();

        const result = await runTool(getObjectDefinitionTool, { name: 'nope' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/not found/i);
    });
});

describe('search_objects', () => {
    it('searches relations, routines and columns', async () => {
        const ctx = makeContext();

        await runTool(searchObjectsTool, { pattern: 'cust' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/pg_attribute/);
        expect(ctx.executor.lastSql).toMatch(/pg_proc/);
        expect(ctx.executor.lastParams).toMatchObject({ pattern: '%cust%' });
    });

    it('narrows to the requested types and honours the limit', async () => {
        const ctx = makeContext();

        await runTool(searchObjectsTool, { pattern: 'x', types: ['table'], limit: 7 }, ctx);

        expect(ctx.executor.lastSql).not.toMatch(/pg_attribute/);
        expect(ctx.executor.lastSql).not.toMatch(/pg_proc/);
        expect(ctx.executor.calls[0]?.maxRows).toBe(7);
    });
});

describe('sample_data', () => {
    it('selects with LIMIT from a quoted table name', async () => {
        const ctx = makeContext();

        await runTool(sampleDataTool, { table: 'sales.or"ders' }, ctx);

        expect(ctx.executor.lastSql).toBe('select * from "sales"."or""ders" limit @limit');
        expect(ctx.executor.lastParams).toMatchObject({ limit: 10 });
    });

    it('supports random sampling and a column subset', async () => {
        const ctx = makeContext();

        await runTool(
            sampleDataTool,
            { table: 't', columns: ['id', 'na"me'], random: true, limit: 3 },
            ctx,
        );

        expect(ctx.executor.lastSql).toBe(
            'select "id", "na""me" from "public"."t" order by random() limit @limit',
        );
        expect(ctx.executor.lastParams).toMatchObject({ limit: 3 });
    });
});
