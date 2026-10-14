import { z } from 'zod';
import {
    databaseArg,
    firstRow,
    jsonOutput,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

const inputSchema = z.object({ database: databaseArg });

const SQL = `
select
    sqlite_version() as "version",
    (select file from pragma_database_list where name = 'main') as "file",
    (select page_size from pragma_page_size) as "pageSize",
    (select page_count from pragma_page_count) as "pageCount",
    (select page_size from pragma_page_size) * (select page_count from pragma_page_count) as "sizeBytes",
    (select journal_mode from pragma_journal_mode) as "journalMode",
    (select encoding from pragma_encoding) as "encoding",
    (select user_version from pragma_user_version) as "userVersion",
    (select application_id from pragma_application_id) as "applicationId",
    (select count(*) from pragma_compile_options) as "compileOptions",
    (select count(*) from pragma_database_list) as "attachedDatabases",
    datetime('now') as "serverTime"`;

export const getServerInfoTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_server_info',
    title: 'Get server info',
    description:
        'Returns the SQLite library version, the file path and size, page size, journal mode, encoding, user version and the current time.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({ database, signal: context.signal, sql: SQL });
        return jsonOutput({ database: database ?? null, ...(firstRow(result) ?? {}) });
    },
};
