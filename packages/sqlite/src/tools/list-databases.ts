import { z } from 'zod';
import {
    databaseArg,
    jsonOutput,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    rowsToObjects,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

const inputSchema = z.object({ database: databaseArg });

const SQL = 'select name, file from pragma_database_list order by seq';

export const listDatabasesTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_databases',
    title: 'List databases',
    description:
        'Lists the schemas attached to the open file (main, temp, ...) and the database keys this server is configured with. Pass a key as the `database` argument of any tool to query another configured file.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({ database, signal: context.signal, sql: SQL });
        return jsonOutput({
            attached: rowsToObjects(result),
            configured: context.config.allowedDatabases,
            current: database ?? null,
        });
    },
};
