import type { Dialect } from '../../src/dialect.js';
import { createIdentifierTools } from '../../src/sql/identifiers.js';

/** Minimal dialect for core tests: double-quoted identifiers, a tiny guard profile. */
export const testDialect: Dialect = {
    name: 'test',
    displayName: 'Test SQL',
    guard: {
        alwaysBlocked: [{ label: 'SHUTDOWN', pattern: /\bshutdown\b/i }],
        isSessionLocal: (target) => target.startsWith('tmp_'),
        readOnlyBlocked: [
            { label: 'DELETE', pattern: /\bdelete\b/i },
            { label: 'UPDATE', pattern: /\bupdate\b/i },
            { label: 'DROP', pattern: /\bdrop\b/i },
        ],
        scrub: { identifierQuotes: [['"', '"']], lineComments: ['--'] },
        targetedWrites: [{ label: 'INSERT', pattern: /\binsert\s+into\s+([\w.]+)/gi }],
    },
    identifiers: createIdentifierTools({
        open: '"',
        close: '"',
        defaultSchema: 'public',
        maxLength: 63,
    }),
    likeEscape: 'backslash',
    probeSql: 'select current_database() as database, current_user as login, now() as "serverTime"',
    readOnlyVariable: 'TEST_READ_ONLY',
};
