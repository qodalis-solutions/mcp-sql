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
    (select version_full from product_component_version where product like 'Oracle%' and rownum = 1) as "version",
    sys_context('userenv', 'db_name') as "database",
    sys_context('userenv', 'con_name') as "container",
    sys_context('userenv', 'instance_name') as "instance",
    sys_context('userenv', 'server_host') as "serverHost",
    sys_context('userenv', 'session_user') as "login",
    sys_context('userenv', 'current_schema') as "currentSchema",
    sys_context('userenv', 'nls_date_format') as "dateFormat",
    sessiontimezone as "sessionTimeZone",
    dbtimezone as "dbTimeZone",
    systimestamp as "serverTime"
from dual`;

export const getServerInfoTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_server_info',
    title: 'Get server info',
    description:
        'Returns the Oracle version, database and container names, instance, host, time zones, the session user and current schema.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({ database, signal: context.signal, sql: SQL });
        return jsonOutput(firstRow(result) ?? {});
    },
};
