import { z } from 'zod';
import {
    databaseArg,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    resultOutput,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';

const inputSchema = z.object({ database: databaseArg });

const SQL = `
select
    d.datname as "name",
    pg_get_userbyid(d.datdba) as "owner",
    pg_encoding_to_char(d.encoding) as "encoding",
    d.datcollate as "collation",
    d.datallowconn as "allowsConnections",
    case when has_database_privilege(d.datname, 'CONNECT') then pg_size_pretty(pg_database_size(d.datname)) end as "size"
from pg_database as d
where not d.datistemplate
order by d.datname`;

export const listDatabasesTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_databases',
    title: 'List databases',
    description:
        'Lists the databases on this server (templates excluded). Only allowlisted databases can be queried through this MCP server.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({ database, signal: context.signal, sql: SQL });
        return resultOutput(result);
    },
};
