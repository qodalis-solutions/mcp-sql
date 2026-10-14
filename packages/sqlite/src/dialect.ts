import {
    createIdentifierTools,
    type Dialect,
    type GuardProfile,
    type SessionLocalContext,
} from '@qodalis/mcp-sql-core';

const ALWAYS_BLOCKED = [
    { label: 'ATTACH', pattern: /\battach\b/i },
    { label: 'DETACH', pattern: /\bdetach\b/i },
    { label: 'load_extension', pattern: /\bload_extension\s*\(/i },
    { label: 'PRAGMA writable_schema', pattern: /\bpragma\s+(\w+\.)?writable_schema\b/i },
    { label: 'PRAGMA trusted_schema', pattern: /\bpragma\s+(\w+\.)?trusted_schema\b/i },
    { label: 'VACUUM INTO', pattern: /\bvacuum\b[\s\S]*?\binto\b/i },
];

const TEMP_OBJECT = String.raw`(?:(?:temp|temporary)\s+)?`;

const READ_ONLY_BLOCKED = [
    { label: 'ALTER', pattern: /\balter\s+table\b/i },
    { label: 'VACUUM', pattern: /\bvacuum\b/i },
    { label: 'REINDEX', pattern: /\breindex\b/i },
    { label: 'ANALYZE', pattern: /^\s*analyze\b|;\s*analyze\b/i },
    { label: 'REPLACE', pattern: /(?<!\bor\s)\breplace\s+into\b/i },
    { label: 'PRAGMA assignment', pattern: /\bpragma\s+[\w.]+\s*=/i },
    {
        label: 'CREATE (non-table)',
        pattern: new RegExp(
            String.raw`\bcreate\s+(?!${TEMP_OBJECT}(?:table|view|index|trigger)\b)(?!unique\s+index\b)(?!virtual\s+table\b)\w+`,
            'i',
        ),
    },
    { label: 'DROP (non-table)', pattern: /\bdrop\s+(?!(?:table|view|index|trigger)\b)\w+/i },
];

const TARGET = String.raw`((?:[\w]+\.)?[\w]+)`;
const OR_ACTION = String.raw`(?:or\s+(?:abort|fail|ignore|replace|rollback)\s+)?`;
const IF_NOT_EXISTS = String.raw`(?:if\s+not\s+exists\s+)?`;
const IF_EXISTS = String.raw`(?:if\s+exists\s+)?`;

/** Writes that are fine in read-only mode when every target is session-local. */
const TARGETED_WRITES = [
    {
        label: 'INSERT',
        pattern: new RegExp(String.raw`\binsert\s+${OR_ACTION}into\s+${TARGET}`, 'gi'),
    },
    { label: 'UPDATE', pattern: new RegExp(String.raw`\bupdate\s+${OR_ACTION}${TARGET}`, 'gi') },
    { label: 'DELETE', pattern: new RegExp(String.raw`\bdelete\s+from\s+${TARGET}`, 'gi') },
    {
        label: 'CREATE',
        pattern: new RegExp(
            String.raw`\bcreate\s+${TEMP_OBJECT}(?:table|view)\s+${IF_NOT_EXISTS}${TARGET}`,
            'gi',
        ),
    },
    {
        label: 'CREATE',
        pattern: new RegExp(
            String.raw`\bcreate\s+(?:unique\s+)?index\s+${IF_NOT_EXISTS}[\w.]+\s+on\s+${TARGET}`,
            'gi',
        ),
    },
    {
        label: 'CREATE',
        pattern: new RegExp(
            String.raw`\bcreate\s+${TEMP_OBJECT}trigger\s+${IF_NOT_EXISTS}[\w.]+\s+(?:(?:before|after|instead\s+of)\s+)?(?:insert|update(?:\s+of\s+[\w\s,]+?)?|delete)\s+on\s+${TARGET}`,
            'gi',
        ),
    },
    {
        label: 'DROP',
        pattern: new RegExp(
            String.raw`\bdrop\s+(?:table|view|index|trigger)\s+${IF_EXISTS}${TARGET}`,
            'gi',
        ),
    },
];

const DECLARES_TEMP = [
    new RegExp(
        String.raw`\bcreate\s+(?:temp|temporary)\s+(?:table|view)\s+${IF_NOT_EXISTS}${TARGET}`,
        'gi',
    ),
];

const normalize = (name: string): string => name.toLowerCase().replace(/^temp\./, '');

/** Names declared temporary earlier in the batch (`create temp table x`). */
const declaredTempNames = (sql: string): Set<string> => {
    const found = new Set<string>();
    for (const pattern of DECLARES_TEMP) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(sql)) !== null) {
            found.add(normalize(match[1] ?? ''));
        }
    }
    return found;
};

/**
 * A target is session-local when it lives in the `temp` schema, when the
 * statement itself says TEMP, or when an earlier statement in the batch
 * created it as a temp object. Indexes and triggers follow the table they
 * are created on, so an index on a temp table is temp too.
 */
const isSessionLocal = (target: string, context: SessionLocalContext): boolean => {
    if (target.toLowerCase().startsWith('temp.')) {
        return true;
    }
    if (/\b(temp|temporary)\b/i.test(context.statement)) {
        return true;
    }
    return declaredTempNames(context.sql).has(normalize(target));
};

export const guardProfile: GuardProfile = {
    alwaysBlocked: ALWAYS_BLOCKED,
    isSessionLocal,
    readOnlyBlocked: READ_ONLY_BLOCKED,
    scrub: {
        identifierQuotes: [
            ['"', '"'],
            ['[', ']'],
            ['`', '`'],
        ],
        lineComments: ['--'],
    },
    targetedWrites: TARGETED_WRITES,
};

export const identifiers = createIdentifierTools({
    open: '"',
    close: '"',
    defaultSchema: 'main',
    maxLength: 255,
});

export const sqliteDialect: Dialect = {
    name: 'sqlite',
    displayName: 'SQLite',
    guard: guardProfile,
    identifiers,
    likeEscape: 'backslash',
    probeSql: `select (select file from pragma_database_list where name = 'main') as "database", 'local' as "login", datetime('now') as "serverTime", sqlite_version() as "version"`,
    readOnlyVariable: 'SQLITE_READ_ONLY',
};
