import { createIdentifierTools, type Dialect, type GuardProfile } from '@qodalis/mcp-sql-core';

const ALWAYS_BLOCKED = [
    { label: 'xp_cmdshell', pattern: /\bxp_cmdshell\b/i },
    { label: 'xp_ extended procedures', pattern: /\bxp_(?!cmdshell)\w+/i },
    { label: 'sp_configure', pattern: /\bsp_configure\b/i },
    { label: 'sp_OA* automation procedures', pattern: /\bsp_oa\w+/i },
    {
        label: 'sp_addsrvrolemember / sp_addlogin',
        pattern: /\bsp_add(srvrolemember|login|user)\b/i,
    },
    { label: 'RECONFIGURE', pattern: /\breconfigure\b/i },
    { label: 'SHUTDOWN', pattern: /\bshutdown\b/i },
    { label: 'KILL', pattern: /\bkill\b/i },
    {
        label: 'RESTORE',
        pattern: /\brestore\s+(database|log|filelistonly|headeronly|verifyonly)\b/i,
    },
    { label: 'BACKUP', pattern: /\bbackup\s+(database|log|certificate|master\s+key)\b/i },
    { label: 'DROP DATABASE', pattern: /\bdrop\s+database\b/i },
    { label: 'ALTER DATABASE', pattern: /\balter\s+database\b/i },
    { label: 'CREATE DATABASE', pattern: /\bcreate\s+database\b/i },
    { label: 'CREATE LOGIN', pattern: /\bcreate\s+login\b/i },
    { label: 'ALTER LOGIN', pattern: /\balter\s+login\b/i },
    { label: 'DROP LOGIN', pattern: /\bdrop\s+login\b/i },
    { label: 'ALTER SERVER', pattern: /\balter\s+server\b/i },
    { label: 'BULK INSERT', pattern: /\bbulk\s+insert\b/i },
    { label: 'OPENROWSET', pattern: /\bopenrowset\b/i },
    { label: 'OPENDATASOURCE', pattern: /\bopendatasource\b/i },
    { label: 'OPENQUERY', pattern: /\bopenquery\b/i },
    { label: 'ENABLE/DISABLE TRIGGER', pattern: /\b(enable|disable)\s+trigger\b/i },
];

const READ_ONLY_BLOCKED = [
    { label: 'MERGE', pattern: /\bmerge\b(?!\s+join)/i },
    { label: 'ALTER', pattern: /\balter\s+\w+/i },
    { label: 'EXEC', pattern: /\b(exec|execute)\b/i },
    { label: 'DBCC', pattern: /\bdbcc\b/i },
    { label: 'WAITFOR', pattern: /\bwaitfor\b/i },
    { label: 'GRANT', pattern: /\bgrant\b/i },
    { label: 'REVOKE', pattern: /\brevoke\b/i },
    { label: 'DENY', pattern: /\bdeny\b/i },
    { label: 'CREATE (non-table)', pattern: /\bcreate\s+(?!table\b)\w+/i },
    { label: 'DROP (non-table)', pattern: /\bdrop\s+(?!table\b)\w+/i },
    { label: 'TRUNCATE (non-table)', pattern: /\btruncate\s+(?!table\b)\w+/i },
];

/** Writes that are fine in read-only mode when every target is a #temp table or @table variable. */
const TARGETED_WRITES = [
    { label: 'INSERT', pattern: /\binsert\s+(?:into\s+)?(?:top\s*\(\s*\d+\s*\)\s+)?([#@\w.]+)/gi },
    { label: 'UPDATE', pattern: /\bupdate\s+(?:top\s*\(\s*\d+\s*\)\s+)?([#@\w.]+)/gi },
    { label: 'DELETE', pattern: /\bdelete\s+(?:top\s*\(\s*\d+\s*\)\s+)?(?:from\s+)?([#@\w.]+)/gi },
    { label: 'CREATE', pattern: /\bcreate\s+table\s+([#@\w.]+)/gi },
    { label: 'DROP', pattern: /\bdrop\s+table\s+(?:if\s+exists\s+)?([#@\w.]+)/gi },
    { label: 'TRUNCATE', pattern: /\btruncate\s+table\s+([#@\w.]+)/gi },
    { label: 'SELECT INTO', pattern: /\bselect\b(?:(?!\bfrom\b).)*?\binto\s+([#@\w.]+)/gis },
];

const isSessionLocal = (target: string): boolean => {
    const isGlobalTemp = target.startsWith('##');
    if (isGlobalTemp) {
        return false;
    }
    return target.startsWith('#') || target.startsWith('@');
};

export const guardProfile: GuardProfile = {
    alwaysBlocked: ALWAYS_BLOCKED,
    isSessionLocal,
    readOnlyBlocked: READ_ONLY_BLOCKED,
    scrub: {
        identifierQuotes: [
            ['[', ']'],
            ['"', '"'],
        ],
        lineComments: ['--'],
    },
    targetedWrites: TARGETED_WRITES,
};

export const identifiers = createIdentifierTools({
    open: '[',
    close: ']',
    defaultSchema: 'dbo',
    maxLength: 128,
});

export const sqlserverDialect: Dialect = {
    name: 'sqlserver',
    displayName: 'Microsoft SQL Server',
    guard: guardProfile,
    identifiers,
    likeEscape: 'brackets',
    probeSql:
        'select db_name() as [database], suser_sname() as [login], sysdatetimeoffset() as [serverTime]',
    readOnlyVariable: 'SQLSERVER_READ_ONLY',
};
