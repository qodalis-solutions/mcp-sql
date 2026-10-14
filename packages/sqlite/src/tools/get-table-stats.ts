import { z } from 'zod';
import {
    databaseArg,
    firstRow,
    objectParams,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    resultOutput,
    rowsToObjects,
    schemaArg,
    type ObjectName,
    type QueryResult,
    type ToolContext,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

const inputSchema = z.object({
    database: databaseArg,
    schema: schemaArg,
    table: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('A single table to measure. Omit to measure every table (up to `top`).'),
    top: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(25)
        .describe('How many tables to measure when no table is given.'),
});

const TABLES_SQL = `
select schema as "schema", name as "name"
from pragma_table_list
where type = 'table' and name not like 'sqlite\\_%' escape '\\'
order by schema, name
limit @top`;

const SIZE_SQL = `select sum(pgsize) as bytes from dbstat where name = @table`;
const INDEX_COUNT_SQL = `select count(*) as n from pragma_index_list(@table, @schema)`;

const COLUMNS = ['schema', 'table', 'rowCount', 'sizeKb', 'indexCount'];

const measure = async (
    context: ToolContext,
    database: string | undefined,
    object: ObjectName,
    dbstat: { available: boolean },
): Promise<unknown[]> => {
    const params = { schema: object.schema, table: object.name };
    const run = (sql: string) =>
        context.executor.run({ database, params, signal: context.signal, sql });
    const counted = await run(
        `select count(*) as n from ${context.dialect.identifiers.qualifiedName(object)}`,
    );
    let sizeKb: unknown = null;
    if (dbstat.available) {
        try {
            const bytes = firstRow(await run(SIZE_SQL))?.bytes;
            sizeKb = typeof bytes === 'number' ? Math.round(bytes / 1024) : null;
        } catch {
            // dbstat is an optional compile-time module (SQLITE_ENABLE_DBSTAT_VTAB); stop asking.
            dbstat.available = false;
        }
    }
    const indexCount = firstRow(await run(INDEX_COUNT_SQL))?.n ?? null;
    return [object.schema, object.name, firstRow(counted)?.n ?? null, sizeKb, indexCount];
};

export const getTableStatsTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_table_stats',
    title: 'Get table statistics',
    description:
        'Row count, size in KB (when SQLite was built with the dbstat module, otherwise null) and index count, for one table or every table.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const objects: ObjectName[] = args.table
            ? [objectParams(context.dialect, args.table, args.schema).object]
            : rowsToObjects(
                  await context.executor.run({
                      database,
                      params: { top: args.top },
                      signal: context.signal,
                      sql: TABLES_SQL,
                  }),
              ).map((row) => ({ schema: String(row.schema), name: String(row.name) }));
        const dbstat = { available: true };
        const rows: unknown[][] = [];
        for (const object of objects) {
            rows.push(await measure(context, database, object, dbstat));
        }
        const result: QueryResult = {
            columns: COLUMNS.map((name) => ({
                name,
                nullable: true,
                type: name === 'schema' || name === 'table' ? 'TEXT' : 'INTEGER',
            })),
            durationMs: 0,
            messages: [],
            rowCount: rows.length,
            rows,
            rowsAffected: [],
            truncated: false,
        };
        return resultOutput(result);
    },
};
