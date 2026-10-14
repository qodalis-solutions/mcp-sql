import { z } from 'zod';
import { isConnectionError, toPublicError } from '../sql/errors.js';
import { CONNECTION_HINT, firstRow, resolveDatabase, type ToolDefinition } from './context.js';
import { databaseArg, jsonOutput, READ_ONLY_ANNOTATIONS } from './shared.js';

const inputSchema = z.object({ database: databaseArg });

export const testConnectionTool: ToolDefinition<typeof inputSchema> = {
    name: 'test_connection',
    title: 'Test connection',
    description:
        'Proves the database is reachable by running a real query. Reports the server, database, login, server time, read-only mode and pool state. Safe to call at any time; a failure here means the next call will reconnect from scratch.',
    inputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args, context) => {
        const database = resolveDatabase(context, args.database);
        const started = Date.now();
        try {
            const result = await context.executor.run({
                database,
                signal: context.signal,
                sql: context.dialect.probeSql,
            });
            const row = firstRow(result) ?? {};
            return jsonOutput({
                ok: true,
                dialect: context.dialect.name,
                server: context.config.server,
                database: row.database ?? database ?? null,
                login: row.login ?? context.config.user,
                serverTime: row.serverTime ?? null,
                readOnly: context.config.readOnly,
                pool: context.poolState(database),
                durationMs: Date.now() - started,
            });
        } catch (error) {
            const publicError = toPublicError(error, [context.config.password]);
            return jsonOutput(
                {
                    ok: false,
                    dialect: context.dialect.name,
                    server: context.config.server,
                    database: database ?? null,
                    error: publicError,
                    hint: isConnectionError(error)
                        ? CONNECTION_HINT
                        : 'The server answered but rejected the request; check credentials and permissions.',
                    pool: context.poolState(database),
                    durationMs: Date.now() - started,
                },
                true,
            );
        }
    },
};
