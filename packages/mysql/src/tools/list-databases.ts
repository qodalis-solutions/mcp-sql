import { z } from 'zod';
import {
    databaseArg,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    resultOutput,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';
import { SYSTEM_SCHEMAS } from './scope.js';

const inputSchema = z.object({ database: databaseArg });

const SQL = `
select
    schema_name as name,
    default_character_set_name as characterSet,
    default_collation_name as collation
from information_schema.schemata
where schema_name not in ${SYSTEM_SCHEMAS}
order by schema_name`;

export const listDatabasesTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_databases',
    title: 'List databases',
    description:
        'Lists the databases (schemas) visible to the login, system databases excluded. Only allowlisted databases can be queried through this MCP server.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({ database, signal: context.signal, sql: SQL });
        return resultOutput(result);
    },
};
