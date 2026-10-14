#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, loadConfig } from './config.js';
import { applyEnvFile } from './env-file.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';
import { SqlExecutor } from './sql/executor.js';
import { createMssqlPool } from './sql/mssql-pool.js';
import { PoolManager } from './sql/pool-manager.js';

const SHUTDOWN_GRACE_MS = 5000;

// Anything written to stdout corrupts the JSON-RPC stream: all logging goes to stderr.
const log = (message: string): void => {
    process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
};

const usage = `Usage: mcp-sqlserver [--env-file <path>] [--help] [--version]

Configuration is read from the environment (SQLSERVER_* or MSSQL_* names):
  SQLSERVER_HOST (required)        SQLSERVER_PORT (1433)
  SQLSERVER_USER (required)        SQLSERVER_PASSWORD (required)
  SQLSERVER_DATABASE               SQLSERVER_DATABASES (comma-separated allowlist)
  SQLSERVER_DOMAIN (NTLM)          SQLSERVER_ENCRYPT (true)
  SQLSERVER_TRUST_CERT (false)     SQLSERVER_READ_ONLY (true)
  SQLSERVER_MAX_ROWS (1000)        SQLSERVER_CONNECTION_TIMEOUT (8000 ms)
  SQLSERVER_REQUEST_TIMEOUT (30000 ms)  SQLSERVER_POOL_MAX (10)
  SQLSERVER_USE_UTC (true)         SQLSERVER_QUERY_LOG (false)
  SQLSERVER_ENV_FILE               path to a .env file (same as --env-file)
`;

const parseArgs = (argv: string[]): { envFile?: string } => {
    const result: { envFile?: string } = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            process.stdout.write(usage);
            process.exit(0);
        }
        if (arg === '--version' || arg === '-v') {
            process.stdout.write(`${SERVER_VERSION}\n`);
            process.exit(0);
        }
        if (arg === '--env-file') {
            const value = argv[i + 1];
            if (!value) {
                throw new ConfigError('--env-file requires a path.');
            }
            result.envFile = value;
            i++;
            continue;
        }
        throw new ConfigError(`Unknown argument "${arg}".\n${usage}`);
    }
    return result;
};

const main = async (): Promise<void> => {
    const args = parseArgs(process.argv.slice(2));
    const envFile = args.envFile ?? process.env.SQLSERVER_ENV_FILE ?? process.env.MSSQL_ENV_FILE;
    if (envFile) {
        applyEnvFile(envFile, process.env);
    }
    const config = loadConfig(process.env);

    const manager = new PoolManager({ createPool: createMssqlPool(config), log });
    const executor = new SqlExecutor(manager, { maxRows: config.maxRows });
    const queryLogged = config.queryLog
        ? {
              run: async (options: Parameters<typeof executor.run>[0]) => {
                  log(
                      `query on ${options.database ?? '<default>'}: ${options.sql.replace(/\s+/g, ' ').slice(0, 500)}`,
                  );
                  return executor.run(options);
              },
          }
        : executor;

    const handle = serveStdio(
        () =>
            createServer({
                config,
                executor: queryLogged,
                poolState: (database) => manager.describe(database),
            }),
        { onerror: (error) => log(`transport error: ${error.message}`) },
    );
    log(
        `v${SERVER_VERSION} ready for ${config.server}:${config.port} (${config.readOnly ? 'read-only' : 'WRITE'} mode); connections open on first use`,
    );

    let shuttingDown = false;
    const shutdown = async (reason: string): Promise<void> => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        log(`shutting down (${reason})`);
        setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
        await handle.close().catch(() => undefined);
        await manager.closeAll();
        process.exit(0);
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.stdin.once('end', () => void shutdown('stdin closed'));
};

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log(`fatal: ${message}`);
    process.exit(1);
});
