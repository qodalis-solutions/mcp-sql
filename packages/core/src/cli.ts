import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, type CommonConfig, type Env } from './config.js';
import type { Dialect } from './dialect.js';
import { applyEnvFile } from './env-file.js';
import { createServer } from './server.js';
import type { IQueryExecutor, RunOptions } from './sql/executor.js';
import type { PoolState } from './sql/pool-manager.js';
import type { AnyToolDefinition } from './tools/context.js';

const SHUTDOWN_GRACE_MS = 5000;

export type Runtime = {
    closeAll: () => Promise<void>;
    executor: IQueryExecutor;
    poolState: (database: string | undefined) => PoolState;
};

export type CliSpec<TConfig extends CommonConfig> = {
    /** Builds the dialect's executor and pool manager from the loaded config. */
    createRuntime: (config: TConfig, log: (message: string) => void) => Runtime;
    dialect: Dialect;
    /** Names of the env-file variables, most specific first. */
    envFileVariables: string[];
    loadConfig: (env: Env) => TConfig;
    packageName: string;
    tools: AnyToolDefinition[];
    /** Text printed for --help after the generic usage line. */
    usage: string;
    version: string;
    websiteUrl?: string;
};

export const createLogger =
    (packageName: string) =>
    (message: string): void => {
        // Anything written to stdout corrupts the JSON-RPC stream: all logging goes to stderr.
        process.stderr.write(`[${packageName}] ${message}\n`);
    };

const parseArgs = (argv: string[], spec: CliSpec<CommonConfig>): { envFile?: string } => {
    const result: { envFile?: string } = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            process.stdout.write(
                `Usage: ${spec.packageName} [--env-file <path>] [--help] [--version]\n\n${spec.usage}`,
            );
            process.exit(0);
        }
        if (arg === '--version' || arg === '-v') {
            process.stdout.write(`${spec.version}\n`);
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
        throw new ConfigError(`Unknown argument "${arg}".`);
    }
    return result;
};

const withQueryLog = (
    executor: IQueryExecutor,
    log: (message: string) => void,
): IQueryExecutor => ({
    run: async (options: RunOptions) => {
        log(
            `query on ${options.database ?? '<default>'}: ${options.sql.replace(/\s+/g, ' ').slice(0, 500)}`,
        );
        return executor.run(options);
    },
});

/** Shared `main()` for every dialect's bin: args, env file, config, server, shutdown. */
export const runCli = async <TConfig extends CommonConfig>(
    spec: CliSpec<TConfig>,
): Promise<void> => {
    const log = createLogger(spec.packageName);
    try {
        const args = parseArgs(process.argv.slice(2), spec as unknown as CliSpec<CommonConfig>);
        const envFile =
            args.envFile ?? spec.envFileVariables.map((name) => process.env[name]).find(Boolean);
        if (envFile) {
            applyEnvFile(envFile, process.env);
        }
        const config = spec.loadConfig(process.env);
        const runtime = spec.createRuntime(config, log);
        const executor = config.queryLog ? withQueryLog(runtime.executor, log) : runtime.executor;

        const handle = serveStdio(
            () =>
                createServer({
                    config,
                    dialect: spec.dialect,
                    executor,
                    name: spec.packageName,
                    poolState: runtime.poolState,
                    tools: spec.tools,
                    version: spec.version,
                    ...(spec.websiteUrl ? { websiteUrl: spec.websiteUrl } : {}),
                }),
            { onerror: (error) => log(`transport error: ${error.message}`) },
        );
        log(
            `v${spec.version} ready for ${config.server}:${config.port} (${config.readOnly ? 'read-only' : 'WRITE'} mode); connections open on first use`,
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
            await runtime.closeAll();
            process.exit(0);
        };
        process.once('SIGINT', () => void shutdown('SIGINT'));
        process.once('SIGTERM', () => void shutdown('SIGTERM'));
        process.stdin.once('end', () => void shutdown('stdin closed'));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`fatal: ${message}`);
        process.exit(1);
    }
};
