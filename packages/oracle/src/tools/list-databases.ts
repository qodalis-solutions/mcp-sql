import { z } from 'zod';
import {
    databaseArg,
    READ_ONLY_ANNOTATIONS,
    resolveDatabase,
    resultOutput,
    type ToolDefinition,
} from '@qodalis/mcp-sql-core';
import { SYSTEM_SCHEMAS } from './shared.js';

const inputSchema = z.object({
    database: databaseArg,
    includeSystem: z
        .boolean()
        .default(false)
        .describe('Also list the schemas Oracle maintains itself (SYS, SYSTEM, ...).'),
});

const buildSql = (includeSystem: boolean): string => `
select
    u.username as "schema",
    u.created as "created",
    case when u.username = sys_context('userenv', 'current_schema') then 1 else 0 end as "isCurrent"
from all_users as u
where 1 = 1${includeSystem ? '' : ` and u.oracle_maintained = 'N' and u.username not in (${SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(', ')})`}
order by u.username`;

export const listDatabasesTool: ToolDefinition<typeof inputSchema> = {
    name: 'list_databases',
    title: 'List schemas',
    description:
        'Lists the schemas (users) visible to the login. An Oracle session lives in one database, so the "database" argument of every tool selects a SCHEMA; only allowlisted schemas can be targeted.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const result = await context.executor.run({
            database,
            signal: context.signal,
            sql: buildSql(args.includeSystem).replace(/\bas u\b/, 'u'),
        });
        return resultOutput(result);
    },
};
