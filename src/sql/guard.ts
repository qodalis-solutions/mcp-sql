/**
 * Statement guard for incoming SQL.
 *
 * Two layers:
 *  1. Server-level statements are blocked in every mode (command execution,
 *     configuration, backups, logins, linked-server access).
 *  2. In read-only mode, data and schema changes are blocked unless they target
 *     a session-local temp table (`#name`) or a table variable (`@name`).
 *
 * The SQL is scrubbed first (strings, comments and quoted identifiers removed) so
 * keywords inside literals cannot trigger false positives, and keywords hidden
 * in comments cannot slip past.
 */
export type GuardOptions = {
    readOnly: boolean;
};

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Removes comments and blanks string literals and quoted identifiers. */
export const scrubSql = (sql: string): string => {
    let out = '';
    let i = 0;
    const n = sql.length;
    while (i < n) {
        const ch = sql[i];
        const next = sql[i + 1];
        if (ch === '-' && next === '-') {
            while (i < n && sql[i] !== '\n') {
                i++;
            }
            continue;
        }
        if (ch === '/' && next === '*') {
            const end = sql.indexOf('*/', i + 2);
            i = end === -1 ? n : end + 2;
            continue;
        }
        if (ch === "'" || ch === '"') {
            const quote = ch;
            i++;
            while (i < n) {
                if (sql[i] === quote) {
                    if (sql[i + 1] === quote) {
                        i += 2;
                        continue;
                    }
                    break;
                }
                i++;
            }
            i++;
            out += quote + quote;
            continue;
        }
        if (ch === '[') {
            const end = sql.indexOf(']', i + 1);
            i = end === -1 ? n : end + 1;
            out += '[]';
            continue;
        }
        out += ch;
        i++;
    }
    return out;
};

type Rule = { label: string; pattern: RegExp };

const ALWAYS_BLOCKED: Rule[] = [
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

/** Marker-less patterns for read-only mode: anything matching is rejected outright. */
const READ_ONLY_BLOCKED: Rule[] = [
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

/**
 * Write statements that are acceptable in read-only mode when (and only when)
 * every target is a session-local temp table or table variable.
 */
const TARGETED_WRITES: Array<{ label: string; pattern: RegExp }> = [
    { label: 'INSERT', pattern: /\binsert\s+(?:into\s+)?(?:top\s*\(\s*\d+\s*\)\s+)?([#@\w.]+)/gi },
    { label: 'UPDATE', pattern: /\bupdate\s+(?:top\s*\(\s*\d+\s*\)\s+)?([#@\w.]+)/gi },
    { label: 'DELETE', pattern: /\bdelete\s+(?:top\s*\(\s*\d+\s*\)\s+)?(?:from\s+)?([#@\w.]+)/gi },
    { label: 'CREATE', pattern: /\bcreate\s+table\s+([#@\w.]+)/gi },
    { label: 'DROP', pattern: /\bdrop\s+table\s+(?:if\s+exists\s+)?([#@\w.]+)/gi },
    { label: 'TRUNCATE', pattern: /\btruncate\s+table\s+([#@\w.]+)/gi },
    { label: 'SELECT INTO', pattern: /\binto\s+([#@\w.]+)/gi },
];

const isSessionLocal = (target: string): boolean => {
    const isGlobalTemp = target.startsWith('##');
    if (isGlobalTemp) {
        return false;
    }
    return target.startsWith('#') || target.startsWith('@');
};

const findRule = (sql: string, rules: Rule[]): Rule | undefined =>
    rules.find((rule) => rule.pattern.test(sql));

const findPersistentWrite = (sql: string): string | undefined => {
    for (const write of TARGETED_WRITES) {
        write.pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = write.pattern.exec(sql)) !== null) {
            const target = match[1] ?? '';
            const isInsertInto =
                write.label === 'SELECT INTO' && /\binsert\s+$/i.test(sql.slice(0, match.index));
            if (isInsertInto) {
                continue;
            }
            if (!isSessionLocal(target)) {
                return write.label;
            }
        }
    }
    return undefined;
};

/** Validates a batch against the guard rules. */
export const validateSql = (sql: string, options: GuardOptions): GuardResult => {
    const scrubbed = scrubSql(sql).trim();
    if (scrubbed.length === 0) {
        return { ok: false, reason: 'Query is empty.' };
    }

    const blocked = findRule(scrubbed, ALWAYS_BLOCKED);
    if (blocked) {
        return { ok: false, reason: `${blocked.label} is never allowed through this server.` };
    }

    if (!options.readOnly) {
        return { ok: true };
    }

    const readOnlyBlocked = findRule(scrubbed, READ_ONLY_BLOCKED);
    if (readOnlyBlocked) {
        return {
            ok: false,
            reason: `${readOnlyBlocked.label} is not allowed in read-only mode (set SQLSERVER_READ_ONLY=false to enable writes).`,
        };
    }

    const persistentWrite = findPersistentWrite(scrubbed);
    if (persistentWrite) {
        return {
            ok: false,
            reason: `${persistentWrite} against a persistent table is not allowed in read-only mode; only #temp tables and @table variables may be written.`,
        };
    }

    return { ok: true };
};
