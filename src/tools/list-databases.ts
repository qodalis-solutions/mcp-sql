import { z } from 'zod';
import { resolveDatabase, type ToolDefinition } from './context.js';
import { databaseArg, READ_ONLY_ANNOTATIONS, resultOutput } from './shared.js';

const inputSchema = z.object({ database: databaseArg });

const SQL = `
select
    [name],
    [state_desc] as [state],
    [recovery_model_desc] as [recoveryModel],
    [compatibility_level] as [compatibilityLevel],
    [collation_name] as [collation],
    [create_date] as [createDate]
from sys.databases
order by [name]`;

export const listDatabasesTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_databases',
    title: 'List databases',
    description:
        'Lists the databases visible to the login on this server. Note that only allowlisted databases can be queried through this MCP server.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({ database, signal: context.signal, sql: SQL });
        return resultOutput(result);
    },
};
