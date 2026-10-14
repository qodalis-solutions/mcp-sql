import { resolveDatabase, type ToolContext } from '@qodalis/mcp-sql-core';
import { normalizeSchemaName } from '../config.js';

/**
 * Oracle sessions live in one database, so the shared `database` argument and
 * the allowlist are about SCHEMAS. Returns the upper-cased schema to look in
 * and the pool key (the configured default) the query should run on.
 */
export const resolveSchema = (
    context: ToolContext,
    requestedSchema: string | undefined,
    requestedDatabase: string | undefined,
): { database: string | undefined; schema: string } => {
    const database = resolveDatabase(context, requestedDatabase);
    const schema =
        resolveDatabase(context, requestedSchema ?? requestedDatabase) ?? context.config.user;
    return { database, schema: normalizeSchemaName(schema) };
};

/** Schemas Oracle installs itself; hidden from schema-less listings. */
export const SYSTEM_SCHEMAS = [
    'ANONYMOUS',
    'APPQOSSYS',
    'AUDSYS',
    'CTXSYS',
    'DBSFWUSER',
    'DBSNMP',
    'DGPDB_INT',
    'DIP',
    'DVF',
    'DVSYS',
    'GGSHAREDCAP',
    'GGSYS',
    'GSMADMIN_INTERNAL',
    'GSMCATUSER',
    'GSMROOTUSER',
    'GSMUSER',
    'LBACSYS',
    'MDDATA',
    'MDSYS',
    'OJVMSYS',
    'OLAPSYS',
    'ORACLE_OCM',
    'ORDDATA',
    'ORDPLUGINS',
    'ORDSYS',
    'OUTLN',
    'REMOTE_SCHEDULER_AGENT',
    'SI_INFORMTN_SCHEMA',
    'SYS',
    'SYS$UMF',
    'SYSBACKUP',
    'SYSDG',
    'SYSKM',
    'SYSRAC',
    'SYSTEM',
    'VECSYS',
    'WMSYS',
    'XDB',
    'XS$NULL',
];
