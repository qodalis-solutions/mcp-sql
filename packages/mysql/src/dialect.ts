import {
    createIdentifierTools,
    type Dialect,
    type GuardProfile,
    type SessionLocalContext,
} from '@qodalis/mcp-sql-core';

const ALWAYS_BLOCKED = [
    { label: 'LOAD DATA', pattern: /\bload\s+(data|xml)\b/i },
    { label: 'INTO OUTFILE', pattern: /\binto\s+(outfile|dumpfile)\b/i },
    { label: 'LOAD_FILE', pattern: /\bload_file\s*\(/i },
    { label: 'CREATE USER', pattern: /\bcreate\s+(user|role)\b/i },
    { label: 'ALTER USER', pattern: /\balter\s+(user|role)\b/i },
    { label: 'DROP USER', pattern: /\bdrop\s+(user|role)\b/i },
    { label: 'GRANT', pattern: /\bgrant\b/i },
    { label: 'REVOKE', pattern: /\brevoke\b/i },
    { label: 'SET GLOBAL', pattern: /\bset\s+(global|persist|persist_only)\b|\bset\s+@@global\b/i },
    { label: 'INSTALL', pattern: /\b(un)?install\s+(plugin|component)\b/i },
    { label: 'SHUTDOWN', pattern: /^\s*shutdown\b|;\s*shutdown\b/i },
    { label: 'KILL', pattern: /^\s*kill\b|;\s*kill\b/i },
    { label: 'RESET', pattern: /^\s*reset\b|;\s*reset\b/i },
    { label: 'PURGE', pattern: /\bpurge\s+(binary|master)\s+logs\b/i },
    {
        label: 'REPLICATION',
        pattern:
            /\bchange\s+(master|replication\s+source)\b|\b(start|stop|reset)\s+(slave|replica)\b/i,
    },
    { label: 'FLUSH', pattern: /^\s*flush\b|;\s*flush\b/i },
    { label: 'USE', pattern: /^\s*use\s+\S|;\s*use\s+\S/i },
    { label: 'CREATE DATABASE', pattern: /\b(create|drop|alter)\s+(database|schema)\b/i },
];

const READ_ONLY_BLOCKED = [
    { label: 'ALTER', pattern: /\balter\s+\w+/i },
    { label: 'CALL', pattern: /\bcall\s+\w+/i },
    { label: 'DO', pattern: /^\s*do\b|;\s*do\b/i },
    { label: 'HANDLER', pattern: /\bhandler\s+\w+/i },
    { label: 'LOCK', pattern: /\block\s+tables?\b|\bunlock\s+tables\b/i },
    { label: 'OPTIMIZE', pattern: /\boptimize\s+(no_write_to_binlog\s+|local\s+)?table\b/i },
    { label: 'REPAIR', pattern: /\brepair\s+(no_write_to_binlog\s+|local\s+)?table\b/i },
    { label: 'ANALYZE', pattern: /\banalyze\s+(no_write_to_binlog\s+|local\s+)?table\b/i },
    { label: 'CHECKSUM', pattern: /\bchecksum\s+table\b/i },
    { label: 'RENAME', pattern: /\brename\s+(table|user)\b/i },
    { label: 'REPLACE', pattern: /\breplace\s+(low_priority\s+|delayed\s+)?(into\s+)?\w/i },
    {
        label: 'CREATE (non-table)',
        pattern: /(?<!\bshow\s)\bcreate\s+(?!(?:temporary\s+)?table\b)\w+/i,
    },
    { label: 'DROP (non-table)', pattern: /\bdrop\s+(?!(?:temporary\s+)?table\b)\w+/i },
    { label: 'SIGNAL', pattern: /\b(signal|resignal)\s+sqlstate\b/i },
    { label: 'XA', pattern: /^\s*xa\s|;\s*xa\s/i },
];

const TARGET = '((?:`[^`]*`|[\\w]+)(?:\\.(?:`[^`]*`|[\\w]+))?)';

/** Writes that are fine in read-only mode when every target is session-local. */
const TARGETED_WRITES = [
    {
        label: 'INSERT',
        pattern: new RegExp(
            `\\binsert\\s+(?:low_priority\\s+|delayed\\s+|high_priority\\s+)?(?:ignore\\s+)?(?:into\\s+)?${TARGET}`,
            'gi',
        ),
    },
    {
        label: 'UPDATE',
        pattern: new RegExp(`\\bupdate\\s+(?:low_priority\\s+)?(?:ignore\\s+)?${TARGET}`, 'gi'),
    },
    {
        label: 'DELETE',
        pattern: new RegExp(
            `\\bdelete\\s+(?:low_priority\\s+|quick\\s+|ignore\\s+)*from\\s+${TARGET}`,
            'gi',
        ),
    },
    {
        label: 'CREATE',
        pattern: new RegExp(
            `(?<!\\bshow\\s)\\bcreate\\s+(?:temporary\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${TARGET}`,
            'gi',
        ),
    },
    {
        label: 'DROP',
        pattern: new RegExp(
            `\\bdrop\\s+(?:temporary\\s+)?table\\s+(?:if\\s+exists\\s+)?${TARGET}`,
            'gi',
        ),
    },
    { label: 'TRUNCATE', pattern: new RegExp(`\\btruncate\\s+(?:table\\s+)?${TARGET}`, 'gi') },
];

const DECLARES_TEMP = new RegExp(
    `\\bcreate\\s+temporary\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${TARGET}`,
    'gi',
);

const normalize = (name: string): string => name.toLowerCase().replace(/`/g, '');

/** Names declared temporary anywhere in the batch (`create temporary table x`). */
const declaredTempNames = (sql: string): Set<string> => {
    const names = new Set<string>();
    DECLARES_TEMP.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DECLARES_TEMP.exec(sql)) !== null) {
        names.add(normalize(match[1] ?? ''));
    }
    return names;
};

/**
 * A target is session-local when the statement itself says TEMPORARY or an
 * earlier statement in the same batch created it as a temporary table.
 */
const isSessionLocal = (target: string, context: SessionLocalContext): boolean => {
    if (/\btemporary\b/i.test(context.statement)) {
        return true;
    }
    return declaredTempNames(context.sql).has(normalize(target));
};

export const guardProfile: GuardProfile = {
    alwaysBlocked: ALWAYS_BLOCKED,
    isSessionLocal,
    readOnlyBlocked: READ_ONLY_BLOCKED,
    scrub: {
        identifierQuotes: [['`', '`']],
        lineComments: ['--', '#'],
    },
    targetedWrites: TARGETED_WRITES,
};

/**
 * MySQL has no schema below the database, so an unqualified name has no fixed
 * default: the tools fill in the configured database (or `database()`).
 */
export const identifiers = createIdentifierTools({
    close: '`',
    defaultSchema: '',
    maxLength: 64,
    open: '`',
});

export const mysqlDialect: Dialect = {
    displayName: 'MySQL / MariaDB',
    guard: guardProfile,
    identifiers,
    likeEscape: 'backslash',
    name: 'mysql',
    probeSql:
        'select database() as `database`, current_user() as login, now() as serverTime, version() as version',
    readOnlyVariable: 'MYSQL_READ_ONLY',
};
