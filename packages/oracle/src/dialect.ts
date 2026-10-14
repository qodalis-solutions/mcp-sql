import {
    createIdentifierTools,
    type Dialect,
    type GuardProfile,
    type IdentifierTools,
    type ObjectName,
    type SessionLocalContext,
} from '@qodalis/mcp-sql-core';

const ALWAYS_BLOCKED = [
    { label: 'DBMS_SCHEDULER', pattern: /\bdbms_scheduler\b/i },
    { label: 'DBMS_PIPE', pattern: /\bdbms_pipe\b/i },
    { label: 'DBMS_JAVA', pattern: /\bdbms_java\b/i },
    { label: 'DBMS_ADVISOR', pattern: /\bdbms_advisor\b/i },
    { label: 'DBMS_LOB.FILEOPEN', pattern: /\bdbms_lob\.(file|load)\w*/i },
    { label: 'UTL_FILE', pattern: /\butl_file\b/i },
    { label: 'UTL_HTTP', pattern: /\butl_http\b/i },
    { label: 'UTL_TCP', pattern: /\butl_tcp\b/i },
    { label: 'UTL_SMTP', pattern: /\butl_smtp\b/i },
    { label: 'UTL_INADDR', pattern: /\butl_inaddr\b/i },
    { label: 'BFILENAME', pattern: /\bbfilename\s*\(/i },
    {
        label: 'CREATE/ALTER/DROP USER, ROLE, PROFILE',
        pattern: /\b(create|alter|drop)\s+(user|role|profile)\b/i,
    },
    {
        label: 'DATABASE LINK / DIRECTORY / TABLESPACE / PLUGGABLE DATABASE',
        pattern:
            /\b(create|alter|drop)\s+(?:(?:public|shared)\s+)?(database\s+link|directory|tablespace|pluggable\s+database)\b/i,
    },
    { label: 'ALTER SYSTEM', pattern: /\balter\s+system\b/i },
    { label: 'ALTER DATABASE', pattern: /\balter\s+database\b/i },
    {
        label: 'ALTER SESSION (other than current_schema / nls_*)',
        pattern: /\balter\s+session\s+(?!set\s+(current_schema|nls_\w+)\s*=)/i,
    },
    { label: 'GRANT', pattern: /\bgrant\b/i },
    { label: 'REVOKE', pattern: /\brevoke\b/i },
    { label: 'AUDIT', pattern: /\b(no)?audit\b/i },
    { label: 'SHUTDOWN / STARTUP', pattern: /\b(shutdown|startup)\b/i },
    { label: 'KILL SESSION', pattern: /\bkill\s+session\b/i },
    { label: 'DBMS_SQL', pattern: /\bdbms_sql\b/i },
    { label: 'EXECUTE IMMEDIATE', pattern: /\bexecute\s+immediate\b/i },
];

const READ_ONLY_BLOCKED = [
    { label: 'PL/SQL block', pattern: /^\s*(declare|begin)\b/i },
    { label: 'CALL', pattern: /\bcall\s+\w+/i },
    { label: 'EXEC', pattern: /^\s*exec(ute)?\s+\w+|;\s*exec(ute)?\s+\w+/i },
    { label: 'ALTER', pattern: /\balter\s+(?!session\s+set\s+(current_schema|nls_\w+)\s*=)\w+/i },
    { label: 'MERGE', pattern: /\bmerge\s+into\b/i },
    { label: 'COMMENT ON', pattern: /\bcomment\s+on\b/i },
    { label: 'LOCK TABLE', pattern: /\block\s+table\b/i },
    { label: 'PURGE', pattern: /\bpurge\s+\w+/i },
    { label: 'FLASHBACK', pattern: /\bflashback\s+\w+/i },
    { label: 'ANALYZE', pattern: /\banalyze\s+\w+/i },
    { label: 'RENAME', pattern: /\brename\s+\w+/i },
    { label: 'DBMS_STATS', pattern: /\bdbms_stats\b/i },
    {
        label: 'CREATE (non-table)',
        pattern: /\bcreate\s+(?!(?:(?:global|private)\s+temporary\s+)?table\b)\w+/i,
    },
    { label: 'DROP (non-table)', pattern: /\bdrop\s+(?!table\b)\w+/i },
    { label: 'COMMIT', pattern: /^\s*commit\b|;\s*commit\b/i },
];

const TARGET = '((?:[\\w$#]+\\.)?[\\w$#]+)';

/** Writes that are fine in read-only mode when every target is session-local. */
const TARGETED_WRITES = [
    { label: 'INSERT', pattern: new RegExp(`\\binsert\\s+(?:all\\s+)?into\\s+${TARGET}`, 'gi') },
    { label: 'UPDATE', pattern: new RegExp(`\\bupdate\\s+${TARGET}`, 'gi') },
    { label: 'DELETE', pattern: new RegExp(`\\bdelete\\s+(?:from\\s+)?${TARGET}`, 'gi') },
    {
        label: 'CREATE',
        pattern: new RegExp(
            `\\bcreate\\s+(?:(?:global|private)\\s+temporary\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${TARGET}`,
            'gi',
        ),
    },
    {
        label: 'DROP',
        pattern: new RegExp(`\\bdrop\\s+table\\s+(?:if\\s+exists\\s+)?${TARGET}`, 'gi'),
    },
    { label: 'TRUNCATE', pattern: new RegExp(`\\btruncate\\s+table\\s+${TARGET}`, 'gi') },
];

/** Private temporary tables (18c+) are the only session-local tables Oracle has; their names must start with ORA$PTT_. */
const isPrivateTempName = (target: string): boolean => /^(?:\w+\.)?ora\$ptt_/i.test(target);

const isSessionLocal = (target: string, context: SessionLocalContext): boolean => {
    if (!isPrivateTempName(target)) {
        return false;
    }
    const isGlobalTemp = /\bglobal\s+temporary\b/i.test(context.statement);
    return !isGlobalTemp;
};

export const guardProfile: GuardProfile = {
    alwaysBlocked: ALWAYS_BLOCKED,
    isSessionLocal,
    readOnlyBlocked: READ_ONLY_BLOCKED,
    scrub: {
        identifierQuotes: [['"', '"']],
        lineComments: ['--'],
    },
    targetedWrites: TARGETED_WRITES,
};

const base = createIdentifierTools({ open: '"', close: '"', defaultSchema: '', maxLength: 128 });

const isQuoted = (part: string): boolean => {
    const trimmed = part.trim();
    return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
};

/** Splits `schema.name` on the dots that are outside double quotes. */
const splitQualified = (input: string): string[] => {
    const parts: string[] = [];
    let current = '';
    let quoted = false;
    for (const ch of input) {
        if (ch === '"') {
            quoted = !quoted;
        }
        if (ch === '.' && !quoted) {
            parts.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts;
};

/** Unquoted names fold to upper case, as Oracle does; quoted names keep their case. */
const foldPart = (part: string): string =>
    isQuoted(part) ? part.trim().slice(1, -1).split('""').join('"') : part.trim().toUpperCase();

const parseObjectName = (input: string, schema?: string): ObjectName => {
    const parts = splitQualified(input);
    if (parts.length > 2) {
        throw new Error(
            `Object name "${input}" must be "name" or "schema.name"; database links are not supported.`,
        );
    }
    const name = foldPart(parts[parts.length - 1] ?? '');
    const schemaPart = parts.length === 2 ? parts[0] : schema;
    const resolvedSchema = schemaPart ? foldPart(schemaPart) : '';
    if (!resolvedSchema) {
        throw new Error(
            `Object name "${input}" needs a schema (the configured schema is used when the tool passes one).`,
        );
    }
    return { name, schema: resolvedSchema };
};

export const identifiers: IdentifierTools = { ...base, parseObjectName };

export const oracleDialect: Dialect = {
    name: 'oracle',
    displayName: 'Oracle Database',
    guard: guardProfile,
    identifiers,
    likeEscape: 'backslash',
    probeSql: `select sys_context('userenv', 'db_name') as "database", user as "login", systimestamp as "serverTime" from dual`,
    readOnlyVariable: 'ORACLE_READ_ONLY',
};
