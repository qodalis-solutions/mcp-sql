import { describe, expect, it } from 'vitest';
import { runTool } from '@qodalis/mcp-sql-core';
import {
    makeContext as makeCoreContext,
    resultText as text,
    tableResult,
} from '@qodalis/mcp-sql-core/testing';
import { oracleDialect } from '../../../src/dialect.js';
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
import { resolveSchema } from '../../../src/tools/shared.js';

const makeContext = (overrides = {}) => makeCoreContext(oracleDialect, overrides);

describe('resolveSchema', () => {
    it('upper-cases the configured database as the schema and keeps the pool key', () => {
        const ctx = makeContext();
        expect(resolveSchema(ctx, undefined, undefined)).toEqual({
            database: 'Sales',
            schema: 'SALES',
        });
        expect(resolveSchema(ctx, 'archive', undefined)).toEqual({
            database: 'Sales',
            schema: 'ARCHIVE',
        });
    });

    it('rejects schemas outside the allowlist', () => {
        expect(() => resolveSchema(makeContext(), 'hr', undefined)).toThrow(/not available/);
    });

    it('falls back to the login when no schema is configured', () => {
        const ctx = makeContext();
        ctx.config = { ...ctx.config, allowedDatabases: [], database: undefined };
        expect(resolveSchema(ctx, undefined, undefined).schema).toBe('READER');
    });
});

describe('get_server_info', () => {
    it('reads version, database and session context from dual', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [tableResult(['version', 'database'], [['23.0.0.0.0', 'FREE']])];

        const result = await runTool(getServerInfoTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/product_component_version/);
        expect(ctx.executor.lastSql).toMatch(/sys_context\('userenv', 'db_name'\)/);
        expect(JSON.parse(text(result))).toMatchObject({ version: '23.0.0.0.0', database: 'FREE' });
    });
});

describe('list_databases', () => {
    it('lists non-Oracle-maintained schemas from all_users by default', async () => {
        const ctx = makeContext();

        await runTool(listDatabasesTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/from all_users/);
        expect(ctx.executor.lastSql).toMatch(/oracle_maintained = 'N'/);
        expect(ctx.executor.lastSql).toMatch(/'SYS'/);
    });

    it('includes system schemas on request', async () => {
        const ctx = makeContext();

        await runTool(listDatabasesTool, { includeSystem: true }, ctx);

        expect(ctx.executor.lastSql).not.toMatch(/oracle_maintained/);
    });
});

describe('list_tables', () => {
    it('lists all_tables of the resolved schema with row estimates', async () => {
        const ctx = makeContext();

        await runTool(listTablesTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/from all_tables/);
        expect(ctx.executor.lastSql).toMatch(/num_rows/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'SALES', namePattern: null });
    });

    it('applies schema and name filters with backslash LIKE escaping and can skip row counts', async () => {
        const ctx = makeContext();

        await runTool(
            listTablesTool,
            { schema: 'archive', nameContains: 'ord_er', includeRowCounts: false },
            ctx,
        );

        expect(ctx.executor.lastParams).toMatchObject({
            schema: 'ARCHIVE',
            namePattern: '%ord\\_er%',
        });
        expect(ctx.executor.lastSql).toMatch(/escape '\\'/);
        expect(ctx.executor.lastSql).not.toMatch(/num_rows/);
    });
});

describe('list_views', () => {
    it('unions views and materialized views', async () => {
        const ctx = makeContext();

        await runTool(listViewsTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/from all_views/);
        expect(ctx.executor.lastSql).toMatch(/from all_mviews/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'SALES' });
    });
});

describe('list_procedures', () => {
    it('lists procedures, functions and packages from all_objects by kind', async () => {
        const ctx = makeContext();

        await runTool(listProceduresTool, { kind: 'package' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/from all_objects/);
        expect(ctx.executor.lastSql).toMatch(/'PROCEDURE', 'FUNCTION', 'PACKAGE'/);
        expect(ctx.executor.lastParams).toMatchObject({ kind: 'package', schema: 'SALES' });
    });
});

describe('describe_table', () => {
    it('returns columns, indexes and foreign keys using the ALL_* views with upper-cased names', async () => {
        const ctx = makeContext();
        ctx.executor.resolver = (options) => {
            if (/from all_constraints c/.test(options.sql)) {
                return tableResult(['name'], [['ORDERS_CUSTOMER_FK']]);
            }
            if (/from all_indexes/.test(options.sql)) {
                return tableResult(['name', 'is_primary_key'], [['ORDERS_PK', 1]]);
            }
            if (/from all_tab_cols/.test(options.sql)) {
                return tableResult(['name', 'type'], [['ID', 'NUMBER(10)']]);
            }
            return tableResult([], []);
        };

        const result = await runTool(describeTableTool, { table: 'sales.orders' }, ctx);
        const parsed = JSON.parse(text(result));

        expect(parsed.table).toBe('SALES.ORDERS');
        expect(parsed.columns).toEqual([{ name: 'ID', type: 'NUMBER(10)' }]);
        expect(parsed.indexes).toEqual([{ name: 'ORDERS_PK', is_primary_key: 1 }]);
        expect(parsed.foreignKeys).toEqual([{ name: 'ORDERS_CUSTOMER_FK' }]);
        expect(
            ctx.executor.calls.every(
                (c) => c.params?.schema === 'SALES' && c.params?.table === 'ORDERS',
            ),
        ).toBe(true);
    });

    it('reports a missing table clearly', async () => {
        const ctx = makeContext();

        const result = await runTool(describeTableTool, { table: 'nope' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/SALES\.NOPE.*not found/i);
    });
});

describe('get_foreign_keys', () => {
    it('scopes to a table on either side when given', async () => {
        const ctx = makeContext();

        await runTool(getForeignKeysTool, { table: 'orders' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/constraint_type = 'R'/);
        expect(ctx.executor.lastSql).toMatch(/r\.table_name = @table/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'SALES', table: 'ORDERS' });
    });

    it('lists the whole schema otherwise', async () => {
        const ctx = makeContext();

        await runTool(getForeignKeysTool, {}, ctx);

        expect(ctx.executor.lastParams).toEqual({ schema: 'SALES' });
    });
});

describe('get_table_stats', () => {
    it('reads num_rows, blocks and own-schema segment size', async () => {
        const ctx = makeContext();

        await runTool(getTableStatsTool, { table: 'orders' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/num_rows/);
        expect(ctx.executor.lastSql).toMatch(/user_segments/);
        expect(ctx.executor.lastSql).not.toMatch(/fetch first/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'SALES', table: 'ORDERS' });
    });

    it('returns the largest tables when no table is given', async () => {
        const ctx = makeContext();

        await runTool(getTableStatsTool, { top: 5 }, ctx);

        expect(ctx.executor.lastSql).toMatch(/fetch first @top rows only/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'SALES', top: 5 });
    });
});

describe('get_object_definition', () => {
    it('fetches a view definition from all_views', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [
            tableResult(['type'], [['VIEW']]),
            tableResult(['definition'], [['select 1 from dual']]),
        ];

        const result = await runTool(getObjectDefinitionTool, { name: 'v' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/from all_views/);
        expect(text(result)).toBe('-- view SALES.V\nselect 1 from dual');
    });

    it('assembles package spec and body from all_source', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [
            tableResult(['type'], [['PACKAGE']]),
            tableResult(
                ['type', 'line', 'text'],
                [
                    ['PACKAGE', 1, 'package p is\n'],
                    ['PACKAGE', 2, 'end;\n'],
                    ['PACKAGE BODY', 1, 'package body p is\n'],
                    ['PACKAGE BODY', 2, 'end;\n'],
                ],
            ),
        ];

        const result = await runTool(getObjectDefinitionTool, { name: 'p' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/from all_source/);
        expect(ctx.executor.lastParams).toMatchObject({
            type: 'PACKAGE',
            bodyType: 'PACKAGE BODY',
        });
        expect(text(result)).toBe(
            '-- package SALES.P\n-- package\npackage p is\nend;\n-- package body\npackage body p is\nend;\n',
        );
    });

    it('explains when nothing is found', async () => {
        const ctx = makeContext();

        const result = await runTool(getObjectDefinitionTool, { name: 'nope' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/not found/i);
    });
});

describe('search_objects', () => {
    it('searches objects and columns of the schema', async () => {
        const ctx = makeContext();

        await runTool(searchObjectsTool, { pattern: 'cust' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/from all_objects/);
        expect(ctx.executor.lastSql).toMatch(/from all_tab_columns/);
        expect(ctx.executor.lastParams).toMatchObject({ pattern: '%cust%', schema: 'SALES' });
    });

    it('narrows to the requested types and honours the limit', async () => {
        const ctx = makeContext();

        await runTool(searchObjectsTool, { pattern: 'x', types: ['table'], limit: 7 }, ctx);

        expect(ctx.executor.lastSql).not.toMatch(/all_tab_columns/);
        expect(ctx.executor.lastSql).toMatch(/in \('TABLE'\)/);
        expect(ctx.executor.calls[0]?.maxRows).toBe(7);
    });
});

describe('sample_data', () => {
    it('selects with FETCH FIRST from an upper-cased, quoted table name', async () => {
        const ctx = makeContext();

        await runTool(sampleDataTool, { table: 'sales.or"ders' }, ctx);

        expect(ctx.executor.lastSql).toBe(
            'select * from "SALES"."OR""DERS" fetch first @limit rows only',
        );
        expect(ctx.executor.lastParams).toMatchObject({ limit: 10 });
    });

    it('supports random sampling and a column subset', async () => {
        const ctx = makeContext();

        await runTool(
            sampleDataTool,
            { table: 't', columns: ['ID', 'na"me'], random: true, limit: 3 },
            ctx,
        );

        expect(ctx.executor.lastSql).toBe(
            'select "ID", "na""me" from "SALES"."T" order by dbms_random.value fetch first @limit rows only',
        );
        expect(ctx.executor.lastParams).toMatchObject({ limit: 3 });
    });
});
