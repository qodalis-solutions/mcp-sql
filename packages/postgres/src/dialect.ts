import {
    createIdentifierTools,
    type Dialect,
    type GuardProfile,
    type SessionLocalContext,
} from '@qodalis/mcp-sql-core';

const ALWAYS_BLOCKED = [
    { label: 'COPY ... PROGRAM', pattern: /\bcopy\b[\s\S]*?\bprogram\b/i },
    { label: 'pg_read_file', pattern: /\bpg_read_(binary_)?file\b/i },
    { label: 'pg_ls_dir', pattern: /\bpg_ls_\w+/i },
    { label: 'pg_terminate_backend', pattern: /\bpg_terminate_backend\b/i },
    { label: 'pg_cancel_backend', pattern: /\bpg_cancel_backend\b/i },
    { label: 'pg_reload_conf', pattern: /\bpg_reload_conf\b/i },
    { label: 'ALTER SYSTEM', pattern: /\balter\s+system\b/i },
    { label: 'CREATE ROLE', pattern: /\bcreate\s+role\b/i },
    { label: 'CREATE USER', pattern: /\bcreate\s+user\b/i },
    { label: 'ALTER ROLE', pattern: /\balter\s+(role|user)\b/i },
    { label: 'DROP ROLE', pattern: /\bdrop\s+(role|user)\b/i },
    { label: 'DROP DATABASE', pattern: /\bdrop\s+database\b/i },
    { label: 'CREATE DATABASE', pattern: /\bcreate\s+database\b/i },
    { label: 'ALTER DATABASE', pattern: /\balter\s+database\b/i },
    { label: 'CREATE EXTENSION', pattern: /\bcreate\s+extension\b/i },
    { label: 'dblink', pattern: /\bdblink\w*/i },
    {
        label: 'FOREIGN DATA WRAPPER / SERVER',
        pattern: /\b(create|alter|drop)\s+(server|foreign\s+data\s+wrapper|user\s+mapping)\b/i,
    },
    { label: 'lo_import', pattern: /\blo_(import|export)\b/i },
    { label: 'REINDEX', pattern: /\breindex\b/i },
    { label: 'CREATE/ALTER/DROP TABLESPACE', pattern: /\b(create|alter|drop)\s+tablespace\b/i },
    {
        label: 'CREATE LANGUAGE',
        pattern: /\bcreate\s+(or\s+replace\s+)?(trusted\s+|procedural\s+)*language\b/i,
    },
];

const READ_ONLY_BLOCKED = [
    { label: 'ALTER', pattern: /\balter\s+\w+/i },
    { label: 'COPY', pattern: /\bcopy\b/i },
    { label: 'DO', pattern: /\bdo\s+\$|\bdo\s+language\b|\bdo\s+'/i },
    { label: 'CALL', pattern: /\bcall\s+\w+/i },
    { label: 'GRANT', pattern: /\bgrant\b/i },
    { label: 'REVOKE', pattern: /\brevoke\b/i },
    { label: 'VACUUM', pattern: /\bvacuum\b/i },
    { label: 'ANALYZE (standalone)', pattern: /^\s*analyze\b|;\s*analyze\b/i },
    { label: 'CLUSTER', pattern: /^\s*cluster\b|;\s*cluster\b/i },
    { label: 'REFRESH MATERIALIZED VIEW', pattern: /\brefresh\s+materialized\s+view\b/i },
    { label: 'LOCK', pattern: /\block\s+(table\s+)?\w+/i },
    { label: 'LISTEN', pattern: /\blisten\s+\w+/i },
    { label: 'NOTIFY', pattern: /\bnotify\s+\w+|\bpg_notify\b/i },
    { label: 'UNLISTEN', pattern: /\bunlisten\b/i },
    { label: 'SECURITY LABEL', pattern: /\bsecurity\s+label\b/i },
    {
        label: 'CREATE (non-table)',
        pattern: /\bcreate\s+(?!(?:(?:temp|temporary|unlogged)\s+)?table\b)\w+/i,
    },
    { label: 'DROP (non-table)', pattern: /\bdrop\s+(?!table\b)\w+/i },
    { label: 'MERGE', pattern: /\bmerge\s+into\b/i },
];

const TARGET = '((?:[\\w]+\\.)?[\\w]+)';

/** Writes that are fine in read-only mode when every target is session-local. */
const TARGETED_WRITES = [
    { label: 'INSERT', pattern: new RegExp(`\\binsert\\s+into\\s+${TARGET}`, 'gi') },
    { label: 'UPDATE', pattern: new RegExp(`\\bupdate\\s+(?:only\\s+)?${TARGET}`, 'gi') },
    { label: 'DELETE', pattern: new RegExp(`\\bdelete\\s+from\\s+(?:only\\s+)?${TARGET}`, 'gi') },
    {
        label: 'CREATE',
        pattern: new RegExp(
            `\\bcreate\\s+(?:(?:temp|temporary|unlogged)\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${TARGET}`,
            'gi',
        ),
    },
    {
        label: 'DROP',
        pattern: new RegExp(`\\bdrop\\s+table\\s+(?:if\\s+exists\\s+)?${TARGET}`, 'gi'),
    },
    {
        label: 'TRUNCATE',
        pattern: new RegExp(`\\btruncate\\s+(?:table\\s+)?(?:only\\s+)?${TARGET}`, 'gi'),
    },
    {
        label: 'SELECT INTO',
        pattern: new RegExp(
            `\\binto\\s+(?:(?:temp|temporary|unlogged)\\s+)?(?:table\\s+)?${TARGET}`,
            'gi',
        ),
    },
];

const DECLARES_TEMP = [
    new RegExp(
        `\\bcreate\\s+(?:temp|temporary)\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${TARGET}`,
        'gi',
    ),
    new RegExp(`\\binto\\s+(?:temp|temporary)\\s+(?:table\\s+)?${TARGET}`, 'gi'),
];

const normalize = (name: string): string => name.toLowerCase().replace(/^pg_temp\./, '');

/** Names declared temporary anywhere in the batch (`create temp table x`, `select ... into temp x`). */
const declaredTempNames = (sql: string): Set<string> => {
    const names = new Set<string>();
    for (const pattern of DECLARES_TEMP) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(sql)) !== null) {
            names.add(normalize(match[1] ?? ''));
        }
    }
    return names;
};

/**
 * A target is session-local when it is explicitly in `pg_temp`, when the
 * statement itself declares it temporary, or when an earlier statement in the
 * same batch created it as a temp table.
 */
const isSessionLocal = (target: string, context: SessionLocalContext): boolean => {
    if (target.toLowerCase().startsWith('pg_temp.')) {
        return true;
    }
    const declaresTemp = /\b(temp|temporary)\b/i.test(context.statement);
    if (declaresTemp) {
        return true;
    }
    return declaredTempNames(context.sql).has(normalize(target));
};

export const guardProfile: GuardProfile = {
    alwaysBlocked: ALWAYS_BLOCKED,
    isSessionLocal,
    readOnlyBlocked: READ_ONLY_BLOCKED,
    scrub: {
        dollarQuotes: true,
        identifierQuotes: [['"', '"']],
        lineComments: ['--'],
    },
    targetedWrites: TARGETED_WRITES,
};

export const identifiers = createIdentifierTools({
    open: '"',
    close: '"',
    defaultSchema: 'public',
    maxLength: 63,
});

export const postgresDialect: Dialect = {
    name: 'postgres',
    displayName: 'PostgreSQL',
    guard: guardProfile,
    identifiers,
    likeEscape: 'backslash',
    probeSql:
        'select current_database() as "database", current_user as "login", now() as "serverTime"',
    readOnlyVariable: 'POSTGRES_READ_ONLY',
};
