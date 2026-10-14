import { z } from 'zod';
import {
    databaseArg,
    firstRow,
    likePattern,
    nameContainsArg,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    resultOutput,
    schemaArg,
    type QueryResult,
    type ToolContext,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

const inputSchema = z.object({
    database: databaseArg,
    includeRowCounts: z
        .boolean()
        .default(true)
        .describe(
            'Count the rows of each table (one count(*) per table, capped at 200 tables). Default true.',
        ),
    nameContains: nameContainsArg,
    schema: schemaArg,
});

const ROW_COUNT_CAP = 200;

const SQL = `
select
    schema as "schema",
    name as "name",
    case
        when type = 'virtual' then 'virtual'
        when strict = 1 and wr = 1 then 'strict, without rowid'
        when strict = 1 then 'strict'
        when wr = 1 then 'without rowid'
        else 'table'
    end as "kind",
    ncol as "columnCount"
from pragma_table_list
where
    type in ('table', 'virtual') and
    name not like 'sqlite\\_%' escape '\\' and
    (@schema is null or schema = @schema) and
    (@namePattern is null or name like @namePattern escape '\\')
order by schema, name`;

/** Appends a rowCount column, counting each table with its own query. */
export const withRowCounts = async (
    context: ToolContext,
    database: string | undefined,
    result: QueryResult,
): Promise<QueryResult> => {
    const { qualifiedName } = context.dialect.identifiers;
    const schemaIndex = result.columns.findIndex((c) => c.name === 'schema');
    const nameIndex = result.columns.findIndex((c) => c.name === 'name');
    const rows: unknown[][] = [];
    for (const row of result.rows) {
        const canCount = rows.length < ROW_COUNT_CAP;
        if (!canCount) {
            rows.push([...row, null]);
            continue;
        }
        const object = { schema: String(row[schemaIndex]), name: String(row[nameIndex]) };
        const counted = await context.executor.run({
            database,
            signal: context.signal,
            sql: `select count(*) as n from ${qualifiedName(object)}`,
        });
        rows.push([...row, firstRow(counted)?.n ?? null]);
    }
    return {
        ...result,
        columns: [...result.columns, { name: 'rowCount', nullable: true, type: 'INTEGER' }],
        rows,
    };
};

export const listTablesTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_tables',
    title: 'List tables',
    description:
        'Lists tables with their schema (main, temp or an attached alias), kind (table, strict, without rowid, virtual), column count and optionally row count. Filter by schema or name substring. SQLite internal tables are hidden.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({
            database,
            params: {
                schema: args.schema ?? null,
                namePattern: likePattern(args.nameContains, context.dialect.likeEscape),
            },
            signal: context.signal,
            sql: SQL,
        });
        return resultOutput(
            args.includeRowCounts ? await withRowCounts(context, database, result) : result,
        );
    },
};
