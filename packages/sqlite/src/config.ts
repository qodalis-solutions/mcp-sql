import path from 'node:path';
import {
    ConfigError,
    createEnvReader,
    envNames,
    type CommonConfig,
    type Env,
} from '@qodalis/mcp-sql-core';

/**
 * SQLite configuration. A "database" is a file; each file gets a key (its
 * basename without extension, `memory` for `:memory:`) that the tools'
 * `database` argument refers to. `SQLITE_DATABASE` names the default file and
 * `SQLITE_DATABASES` an allowlist of further files.
 */
export type Config = CommonConfig & {
    /** Create a missing file instead of failing (write mode only makes sense). */
    createIfMissing: boolean;
    /** Database key → absolute file path (or `:memory:`). */
    files: Record<string, string>;
};

const names = (suffix: string): string[] => envNames(['SQLITE'], suffix);

export const ENV_FILE_VARIABLES = names('ENV_FILE');

export const MEMORY = ':memory:';

/** Absolute path for a file reference, leaving `:memory:` alone. */
export const resolveFile = (file: string): string =>
    file === MEMORY ? MEMORY : path.resolve(file);

/** The key a file is addressed by: basename without extension. */
export const keyFor = (file: string): string => {
    if (file === MEMORY) {
        return 'memory';
    }
    const base = path.basename(file);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
};

const collectFiles = (
    explicit: string | undefined,
    allowlist: string[],
): Record<string, string> => {
    const files: Record<string, string> = {};
    for (const file of [explicit, ...allowlist]) {
        if (!file) {
            continue;
        }
        const key = keyFor(file);
        const resolved = resolveFile(file);
        const existing = files[key];
        if (existing !== undefined && existing !== resolved) {
            throw new ConfigError(
                `Two SQLite files share the key "${key}" (${existing} and ${resolved}); rename one so each file has a distinct basename.`,
            );
        }
        files[key] = resolved;
    }
    return files;
};

export const loadConfig = (env: Env = process.env): Config => {
    const read = createEnvReader(env);
    const explicit = read.optional(names('DATABASE'));
    const allowlist = read.list(names('DATABASES'));
    const files = collectFiles(explicit, allowlist);
    const keys = Object.keys(files);
    const database = keys[0];
    if (!database) {
        throw new ConfigError(
            'SQLITE_DATABASE (a file path or :memory:) is required, or SQLITE_DATABASES with at least one file.',
        );
    }
    const defaultFile = files[database] ?? MEMORY;
    return {
        allowedDatabases: keys,
        connectionTimeoutMs: read.positiveInteger(names('CONNECTION_TIMEOUT'), 8000),
        createIfMissing: read.boolean(names('CREATE_IF_MISSING'), false),
        database,
        files,
        maxRows: read.positiveInteger(names('MAX_ROWS'), 1000),
        password: '',
        poolMax: 1,
        port: 0,
        queryLog: read.boolean(names('QUERY_LOG'), false),
        readOnly: read.boolean(names('READ_ONLY'), true),
        requestTimeoutMs: read.positiveInteger(names('REQUEST_TIMEOUT'), 30000),
        server: defaultFile,
        user: 'local',
    };
};

export { ConfigError } from '@qodalis/mcp-sql-core';
