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
    version() as version,
    @@version_comment as edition,
    @@hostname as hostName,
    @@port as port,
    @@character_set_server as characterSet,
    @@collation_server as collation,
    @@time_zone as timeZone,
    @@system_time_zone as systemTimeZone,
    @@max_connections as maxConnections,
    @@read_only as serverReadOnly,
    database() as \`database\`,
    current_user() as login,
    now() as serverTime`;

export const getServerInfoTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_server_info',
    title: 'Get server info',
    description:
        'Returns MySQL/MariaDB version and edition, host, character set, time zone, connection limit, the current database and login.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({ database, signal: context.signal, sql: SQL });
        return jsonOutput(firstRow(result) ?? {});
    },
};
