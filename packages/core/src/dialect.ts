import type { GuardProfile } from './sql/guard.js';
import type { IdentifierTools } from './sql/identifiers.js';
import type { LikeEscapeStyle } from './tools/shared.js';

/**
 * Everything the generic layer needs to know about a database engine. Each
 * dialect package exports one of these alongside its executor and catalog tools.
 */
export type Dialect = {
    /** Short machine name used in logs and server metadata, e.g. `sqlserver`. */
    name: string;
    /** Human name for instructions and messages, e.g. `Microsoft SQL Server`. */
    displayName: string;
    guard: GuardProfile;
    identifiers: IdentifierTools;
    /** How LIKE wildcards in user-supplied fragments are escaped. */
    likeEscape: LikeEscapeStyle;
    /**
     * A cheap query returning one row with columns `database`, `login` and
     * `serverTime`, used by `test_connection` to prove end-to-end connectivity.
     */
    probeSql: string;
    /** Name of the environment variable that toggles writes, for messages. */
    readOnlyVariable: string;
};
