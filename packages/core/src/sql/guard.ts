/**
 * Dialect-agnostic statement guard.
 *
 * The engine scrubs the SQL (comments, string literals and quoted identifiers
 * removed) and then applies a {@link GuardProfile} supplied by the dialect:
 *  1. rules blocked in every mode (command execution, configuration, backups…);
 *  2. in read-only mode, rules blocked outright;
 *  3. in read-only mode, targeted writes that are acceptable only when every
 *     target is session-local (temp table, table variable…).
 */
export type GuardOptions = {
    readOnly: boolean;
};

export type GuardResult = { ok: true } | { ok: false; reason: string };

export type GuardRule = { label: string; pattern: RegExp };

/** A write statement whose first capture group is the target object. */
export type TargetedWrite = { label: string; pattern: RegExp };

export type SessionLocalContext = {
    /** The whole scrubbed batch, so declarations earlier in it can be considered. */
    sql: string;
    /** The matched write statement fragment. */
    statement: string;
};

export type GuardProfile = {
    alwaysBlocked: GuardRule[];
    /** Predicate deciding whether a write target is session-local and therefore harmless. */
    isSessionLocal: (target: string, context: SessionLocalContext) => boolean;
    readOnlyBlocked: GuardRule[];
    scrub: ScrubOptions;
    targetedWrites: TargetedWrite[];
};

export type ScrubOptions = {
    /** Dollar-quoted strings (`$$...$$`, `$tag$...$tag$`), PostgreSQL. */
    dollarQuotes?: boolean;
    /** Identifier quote pairs, e.g. `[']']` for SQL Server, `` ['`','`'] `` for MySQL. */
    identifierQuotes: Array<[string, string]>;
    /** Line comment markers, e.g. `--` and (MySQL) `#`. */
    lineComments: string[];
};

const startsWithAt = (text: string, index: number, token: string): boolean =>
    text.startsWith(token, index);

/** Removes comments and blanks string literals and quoted identifiers, keeping structure. */
export const scrubSql = (sql: string, options: ScrubOptions): string => {
    let out = '';
    let i = 0;
    const n = sql.length;
    while (i < n) {
        const ch = sql[i] ?? '';
        const lineComment = options.lineComments.find((marker) => startsWithAt(sql, i, marker));
        if (lineComment) {
            while (i < n && sql[i] !== '\n') {
                i++;
            }
            continue;
        }
        if (startsWithAt(sql, i, '/*')) {
            const end = sql.indexOf('*/', i + 2);
            i = end === -1 ? n : end + 2;
            continue;
        }
        if (options.dollarQuotes && ch === '$') {
            const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
            if (tagMatch) {
                const tag = tagMatch[0];
                const end = sql.indexOf(tag, i + tag.length);
                i = end === -1 ? n : end + tag.length;
                out += "''";
                continue;
            }
        }
        if (ch === "'") {
            i++;
            while (i < n) {
                if (sql[i] === "'") {
                    if (sql[i + 1] === "'") {
                        i += 2;
                        continue;
                    }
                    break;
                }
                i++;
            }
            i++;
            out += "''";
            continue;
        }
        const quote = options.identifierQuotes.find(([open]) => open === ch);
        if (quote) {
            const [open, close] = quote;
            i++;
            while (i < n) {
                if (sql[i] === close) {
                    if (sql[i + 1] === close) {
                        i += 2;
                        continue;
                    }
                    break;
                }
                i++;
            }
            i++;
            out += open + close;
            continue;
        }
        out += ch;
        i++;
    }
    return out;
};

const findRule = (sql: string, rules: GuardRule[]): GuardRule | undefined =>
    rules.find((rule) => {
        rule.pattern.lastIndex = 0;
        return rule.pattern.test(sql);
    });

const findPersistentWrite = (sql: string, profile: GuardProfile): string | undefined => {
    for (const write of profile.targetedWrites) {
        const pattern = new RegExp(
            write.pattern.source,
            write.pattern.flags.includes('g') ? write.pattern.flags : `${write.pattern.flags}g`,
        );
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(sql)) !== null) {
            const target = match[1] ?? '';
            if (!profile.isSessionLocal(target, { sql, statement: match[0] })) {
                return write.label;
            }
        }
    }
    return undefined;
};

/** Validates a batch against the dialect's guard profile. */
export const validateSql = (
    sql: string,
    options: GuardOptions,
    profile: GuardProfile,
): GuardResult => {
    const scrubbed = scrubSql(sql, profile.scrub).trim();
    if (scrubbed.length === 0) {
        return { ok: false, reason: 'Query is empty.' };
    }

    const blocked = findRule(scrubbed, profile.alwaysBlocked);
    if (blocked) {
        return { ok: false, reason: `${blocked.label} is never allowed through this server.` };
    }

    if (!options.readOnly) {
        return { ok: true };
    }

    const readOnlyBlocked = findRule(scrubbed, profile.readOnlyBlocked);
    if (readOnlyBlocked) {
        return {
            ok: false,
            reason: `${readOnlyBlocked.label} is not allowed in read-only mode (disable read-only mode to enable writes).`,
        };
    }

    const persistentWrite = findPersistentWrite(scrubbed, profile);
    if (persistentWrite) {
        return {
            ok: false,
            reason: `${persistentWrite} against a persistent table is not allowed in read-only mode; only session-local objects may be written.`,
        };
    }

    return { ok: true };
};
