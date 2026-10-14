import { describe, expect, it } from 'vitest';
import { runTool } from '@qodalis/mcp-sql-core';
import {
    makeContext as makeCoreContext,
    resultText as text,
    tableResult,
} from '@qodalis/mcp-sql-core/testing';
import { sqliteDialect } from '../../../src/dialect.js';
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

const makeContext = (overrides = {}) =>
    makeCoreContext(sqliteDialect, {
        config: {
            allowedDatabases: ['app', 'archive'],
            database: 'app',
            maxRows: 1000,
            password: '',
            readOnly: true,
            server: '/data/app.db',
            user: 'local',
        },
        ...overrides,
    });

describe('get_server_info', () => {
    it('reads sqlite_version(), the file and the pragma table-valued functions', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [
            tableResult(['version', 'file', 'pageSize'], [['3.50.4', '/data/app.db', 4096]]),
        ];

        const result = await runTool(getServerInfoTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/sqlite_version\(\)/);
        expect(ctx.executor.lastSql).toMatch(/pragma_page_size/);
        expect(ctx.executor.lastSql).toMatch(/pragma_journal_mode/);
        expect(JSON.parse(text(result))).toMatchObject({ version: '3.50.4', file: '/data/app.db' });
    });
});

describe('list_databases', () => {
    it('lists the attached schemas and the configured database keys', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [
            tableResult(
                ['name', 'file'],
                [
                    ['main', '/data/app.db'],
                    ['temp', ''],
                ],
            ),
        ];

        const result = await runTool(listDatabasesTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/pragma_database_list/);
        expect(JSON.parse(text(result))).toEqual({
            attached: [
                { name: 'main', file: '/data/app.db' },
                { name: 'temp', file: '' },
            ],
            configured: ['app', 'archive'],
            current: 'app',
        });
    });
});

describe('list_tables', () => {
    it('lists tables from pragma_table_list, hiding sqlite internals', async () => {
        const ctx = makeContext();

        await runTool(listTablesTool, { includeRowCounts: false }, ctx);

        expect(ctx.executor.lastSql).toMatch(/pragma_table_list/);
        expect(ctx.executor.lastSql).toMatch(/type in \('table', 'virtual'\)/);
        expect(ctx.executor.lastSql).toMatch(/not like 'sqlite\\_%' escape '\\'/);
    });

    it('applies schema and name filters as parameters with backslash LIKE escaping', async () => {
        const ctx = makeContext();

        await runTool(
            listTablesTool,
            { schema: 'main', nameContains: 'ord_er', includeRowCounts: false },
            ctx,
        );

        expect(ctx.executor.lastParams).toMatchObject({
            schema: 'main',
            namePattern: '%ord\\_er%',
        });
        expect(ctx.executor.lastSql).toMatch(/escape '\\'/);
    });

    it('adds a row count per table with one count query each when asked', async () => {
        const ctx = makeContext();
        ctx.executor.resolver = (options) =>
            /pragma_table_list/.test(options.sql)
                ? tableResult(
                      ['schema', 'name', 'kind', 'columnCount'],
                      [['main', 'orders', 'table', 4]],
                  )
                : tableResult(['n'], [[300]]);

        const result = await runTool(listTablesTool, {}, ctx);
        const parsed = JSON.parse(text(result));

        expect(ctx.executor.calls[1]?.sql).toBe('select count(*) as n from "main"."orders"');
        expect(parsed.columns).toEqual(['schema', 'name', 'kind', 'columnCount', 'rowCount']);
        expect(parsed.rows).toEqual([['main', 'orders', 'table', 4, 300]]);
    });
});

describe('list_views', () => {
    it('lists views from pragma_table_list', async () => {
        const ctx = makeContext();

        await runTool(listViewsTool, {}, ctx);

        expect(ctx.executor.lastSql).toMatch(/type = 'view'/);
    });
});

describe('list_procedures', () => {
    it('explains that SQLite has no stored procedures without querying', async () => {
        const ctx = makeContext();

        const result = await runTool(listProceduresTool, {}, ctx);

        expect(ctx.executor.calls).toHaveLength(0);
        expect(result.isError).toBeFalsy();
        expect(text(result)).toMatch(/no stored procedures/i);
    });
});

describe('describe_table', () => {
    it('returns columns, indexes and foreign keys from the pragma functions', async () => {
        const ctx = makeContext();
        ctx.executor.resolver = (options) => {
            if (/pragma_table_xinfo/.test(options.sql)) {
                return tableResult(['name', 'type'], [['id', 'INTEGER']]);
            }
            if (/pragma_index_list/.test(options.sql)) {
                return tableResult(['name', 'is_unique'], [['orders_idx', 1]]);
            }
            if (/pragma_foreign_key_list/.test(options.sql)) {
                return tableResult(['name', 'direction'], [['fk_0', 'outgoing']]);
            }
            return tableResult([], []);
        };

        const result = await runTool(describeTableTool, { table: 'main.orders' }, ctx);
        const parsed = JSON.parse(text(result));

        expect(parsed.table).toBe('main.orders');
        expect(parsed.columns).toEqual([{ name: 'id', type: 'INTEGER' }]);
        expect(parsed.indexes).toEqual([{ name: 'orders_idx', is_unique: true }]);
        expect(parsed.foreignKeys).toEqual([{ name: 'fk_0', direction: 'outgoing' }]);
        expect(
            ctx.executor.calls.every(
                (c) => c.params?.schema === 'main' && c.params?.table === 'orders',
            ),
        ).toBe(true);
    });

    it('reports a missing table clearly', async () => {
        const ctx = makeContext();

        const result = await runTool(describeTableTool, { table: 'nope' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/main\.nope.*not found/i);
    });
});

describe('get_foreign_keys', () => {
    it('joins pragma_table_list with pragma_foreign_key_list and scopes to a table on either side', async () => {
        const ctx = makeContext();

        await runTool(getForeignKeysTool, { table: 'orders' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/pragma_foreign_key_list/);
        expect(ctx.executor.lastSql).toMatch(/pragma_table_list/);
        expect(ctx.executor.lastParams).toMatchObject({ schema: 'main', table: 'orders' });
    });

    it('lists the whole database otherwise', async () => {
        const ctx = makeContext();

        await runTool(getForeignKeysTool, {}, ctx);

        expect(ctx.executor.lastParams).not.toHaveProperty('table');
    });
});

describe('get_table_stats', () => {
    it('counts rows and indexes per table and reads dbstat sizes when available', async () => {
        const ctx = makeContext();
        ctx.executor.resolver = (options) => {
            if (/pragma_table_list/.test(options.sql)) {
                return tableResult(['schema', 'name'], [['main', 'orders']]);
            }
            if (/count\(\*\) as n from "main"\."orders"/.test(options.sql)) {
                return tableResult(['n'], [[300]]);
            }
            if (/from dbstat/.test(options.sql)) {
                return tableResult(['bytes'], [[40960]]);
            }
            if (/pragma_index_list/.test(options.sql)) {
                return tableResult(['n'], [[2]]);
            }
            return tableResult([], []);
        };

        const result = await runTool(getTableStatsTool, {}, ctx);
        const parsed = JSON.parse(text(result));

        expect(parsed.columns).toEqual(['schema', 'table', 'rowCount', 'sizeKb', 'indexCount']);
        expect(parsed.rows).toEqual([['main', 'orders', 300, 40, 2]]);
    });

    it('leaves the size null when dbstat is not compiled in', async () => {
        const ctx = makeContext();
        ctx.executor.resolver = (options) => {
            if (/from dbstat/.test(options.sql)) {
                throw new Error('no such table: dbstat');
            }
            return tableResult(['n'], [[1]]);
        };

        const result = await runTool(getTableStatsTool, { table: 'orders' }, ctx);
        const parsed = JSON.parse(text(result));

        expect(parsed.rows).toEqual([['main', 'orders', 1, null, 1]]);
    });
});

describe('get_object_definition', () => {
    it('reads the stored SQL from the schema table', async () => {
        const ctx = makeContext();
        ctx.executor.queue = [
            tableResult(['type', 'definition'], [['view', 'CREATE VIEW v AS SELECT 1']]),
        ];

        const result = await runTool(getObjectDefinitionTool, { name: 'v' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/"main"\.sqlite_schema/);
        expect(ctx.executor.lastParams).toMatchObject({ name: 'v' });
        expect(text(result)).toContain('CREATE VIEW v AS SELECT 1');
    });

    it('explains when nothing is found', async () => {
        const ctx = makeContext();

        const result = await runTool(getObjectDefinitionTool, { name: 'nope' }, ctx);

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/not found/i);
    });
});

describe('search_objects', () => {
    it('searches tables, views, indexes, triggers and columns', async () => {
        const ctx = makeContext();

        await runTool(searchObjectsTool, { pattern: 'cust' }, ctx);

        expect(ctx.executor.lastSql).toMatch(/pragma_table_info/);
        expect(ctx.executor.lastSql).toMatch(/sqlite_schema/);
        expect(ctx.executor.lastParams).toMatchObject({ pattern: '%cust%' });
    });

    it('narrows to the requested types and honours the limit', async () => {
        const ctx = makeContext();

        await runTool(searchObjectsTool, { pattern: 'x', types: ['table'], limit: 7 }, ctx);

        expect(ctx.executor.lastSql).not.toMatch(/pragma_table_info/);
        expect(ctx.executor.lastSql).not.toMatch(/'trigger'/);
        expect(ctx.executor.calls[0]?.maxRows).toBe(7);
    });
});

describe('sample_data', () => {
    it('selects with LIMIT from a quoted table name', async () => {
        const ctx = makeContext();

        await runTool(sampleDataTool, { table: 'main.or"ders' }, ctx);

        expect(ctx.executor.lastSql).toBe('select * from "main"."or""ders" limit @limit');
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
            'select "id", "na""me" from "main"."t" order by random() limit @limit',
        );
        expect(ctx.executor.lastParams).toMatchObject({ limit: 3 });
    });
});
