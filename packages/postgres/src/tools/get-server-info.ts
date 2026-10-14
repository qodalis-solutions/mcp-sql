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
    version() as "version",
    current_setting('server_version') as "serverVersion",
    current_setting('server_encoding') as "serverEncoding",
    current_setting('TimeZone') as "timeZone",
    current_setting('max_connections') as "maxConnections",
    inet_server_addr()::text as "serverAddress",
    inet_server_port() as "serverPort",
    current_database() as "database",
    current_user as "login",
    pg_postmaster_start_time() as "startedAt",
    now() as "serverTime",
    pg_is_in_recovery() as "isReplica"`;

export const getServerInfoTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_server_info',
    title: 'Get server info',
    description:
        'Returns PostgreSQL version, encoding, time zone, address, uptime, the current database and login.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({ database, signal: context.signal, sql: SQL });
        return jsonOutput(firstRow(result) ?? {});
    },
};
