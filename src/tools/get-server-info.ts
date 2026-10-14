import { z } from 'zod';
import { firstRow, resolveDatabase, type ToolDefinition } from './context.js';
import { databaseArg, jsonOutput, READ_ONLY_ANNOTATIONS } from './shared.js';

const inputSchema = z.object({ database: databaseArg });

const SQL = `
select
    cast(SERVERPROPERTY('ProductVersion') as nvarchar(128)) as [productVersion],
    cast(SERVERPROPERTY('ProductLevel') as nvarchar(128)) as [productLevel],
    cast(SERVERPROPERTY('Edition') as nvarchar(128)) as [edition],
    cast(SERVERPROPERTY('EngineEdition') as int) as [engineEdition],
    cast(SERVERPROPERTY('MachineName') as nvarchar(128)) as [machineName],
    cast(SERVERPROPERTY('ServerName') as nvarchar(128)) as [serverName],
    cast(SERVERPROPERTY('InstanceName') as nvarchar(128)) as [instanceName],
    cast(SERVERPROPERTY('Collation') as nvarchar(128)) as [collation],
    cast(SERVERPROPERTY('IsClustered') as int) as [isClustered],
    db_name() as [database],
    suser_sname() as [login],
    sysdatetimeoffset() as [serverTime],
    @@VERSION as [version]`;

export const getServerInfoTool: ToolDefinition<typeof inputSchema> = {
    name: 'get_server_info',
    title: 'Get server info',
    description:
        'Returns SQL Server version, edition, collation, machine and instance names, the current database and login.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({ database, signal: context.signal, sql: SQL });
        return jsonOutput(firstRow(result) ?? {});
    },
};
