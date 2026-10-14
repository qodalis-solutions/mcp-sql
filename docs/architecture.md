# Architecture

```
packages/<dialect>/src/cli.ts ─── runCli (core/cli.ts) ─── serveStdio ─── McpServer (core/server.ts)
                               │  registerTool × 13 (tools/*.ts)
                               ▼
                          ToolContext { config, executor, poolState, signal }
                               │
                  IQueryExecutor (sqlserver: SqlExecutor, postgres: PgExecutor)
                               │  withRetry
                        PoolManager (core/sql/pool-manager.ts)
                               │  createPool(database)
            mssql.ConnectionPool (sqlserver/sql/mssql-pool.ts) | pg.Pool (postgres/sql/pg-pool.ts)
```

`@qodalis/mcp-sql-core` owns everything above the driver: configuration,
the pool manager, the statement guard, result formatting, the two
dialect-neutral tools (`execute_query`, `test_connection`), the server and the
CLI. A dialect package supplies a `Dialect` (guard profile, identifier style,
LIKE escaping, probe SQL), an executor, a pool adapter and its catalog tools.
Six packages share it today: SQL Server (`mssql`), PostgreSQL (`pg` +
`pg-cursor`), MySQL/MariaDB (`mysql2`), Oracle (`oracledb` thin mode) and
SQLite (`node:sqlite`, where the "pool" is one open file handle that reopens
when the file is replaced).

Supporting modules: `config.ts` (environment parsing), `env-file.ts`,
`sql/guard.ts` (statement guard), `sql/identifiers.ts` (safe object names),
`sql/errors.ts` (classification and redaction), `format.ts` (json/markdown/csv).

## Why a pool manager

`mssql.ConnectionPool` has three states that matter: `connecting`, `connected`
and closed. A naive server does

```ts
if (!this.pool) {
  this.pool = new ConnectionPool(cfg);
  await this.pool.connect();
}
```

If `connect()` throws (host unreachable while the VPN is down) `this.pool` is
already assigned, every later call skips the connect, and `pool.request()`
throws `Connection is closed` forever. The same happens when the pool emits
`error` after the network drops. Only a process restart fixes it.

`PoolManager` makes pools disposable:

| Situation                                     | Behaviour                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| First call                                    | Create pool, `connect()`, cache only on success.                               |
| `connect()` throws                            | Close the half-built pool, do not cache, rethrow. Next call starts over.       |
| Cached pool reports `connected === false`     | Close it, create a new one.                                                    |
| Pool emits `error`                            | Discard it if it is still the current pool; ignore if it was already replaced. |
| Two calls arrive while connecting             | Both await the same in-flight promise.                                         |
| Query fails with a connection-level error     | Discard the pool, reconnect, run the query once more.                          |
| Query fails with a SQL error or login failure | Propagate immediately, no retry.                                               |
| Shutdown                                      | Close every pool, swallowing close errors.                                     |

`isConnectionError` recognises the driver codes (`ESOCKET`, `ECONNCLOSED`,
`ENOTOPEN`, `ETIMEOUT`, `ECONNRESET`, `EPIPE`, `ENOTFOUND`, ...), the
PostgreSQL SQLSTATE classes `08xxx` and `57P0x`, and the corresponding
messages (`Connection terminated`, `terminating connection`, ...), walking
`originalError` when present. `ELOGIN` and `28P01` are excluded so a bad
password does not loop.

Below the manager, the driver validates every pooled connection with `SELECT 1`
before handing it out (`validateConnection: true`), which replaces sockets that
died while idle without surfacing an error at all.

## Query execution

`SqlExecutor.runOnPool` always streams (`request.stream = true`):

- `recordset` captures column metadata (name, declared type, nullability);
- each `row` is appended until `maxRows` is reached, then the request is
  cancelled and the result marked `truncated`;
- the MCP request's abort signal cancels the request;
- `info` messages (`PRINT`) are collected;
- `done` resolves with `rowsAffected` and the elapsed time.

Streaming keeps memory bounded regardless of what the assistant asks for.

`PgExecutor.runOnPool` checks a client out of `pg.Pool` and reads through a
`pg-cursor` in batches of 200 until `maxRows`; `@name` parameters are rewritten
to `$n`. A multi-statement batch goes through the simple protocol instead
(PostgreSQL requires it) and cannot carry parameters. Errors and aborts settle
the call immediately and destroy the client, because closing a portal on a
dead socket would wait forever for a `readyForQuery`; normal completion closes
the portal first so the client returns to the pool clean, with a bounded wait.
The pool adapter attaches an `error` listener to every client, since a
checked-out client whose backend dies would otherwise crash the process.

## Statement guard

`scrubSql` removes `--` and `/* */` comments and blanks string literals and
quoted identifiers while preserving positions. `validateSql` then matches:

1. always-blocked patterns (command execution, configuration, backup/restore,
   logins, linked servers, bulk operations);
2. in read-only mode, blocked keywords (`MERGE`, `ALTER`, `EXEC`, `DBCC`,
   `WAITFOR`, permissions, non-table `CREATE`/`DROP`/`TRUNCATE`);
3. in read-only mode, targeted writes (`INSERT`, `UPDATE`, `DELETE`,
   `CREATE TABLE`, `DROP TABLE`, `TRUNCATE TABLE`, `SELECT ... INTO`) whose
   target must be session-local: on SQL Server a name starting with `#` (not
   `##`) or `@`; on PostgreSQL `pg_temp.*`, a statement that says `TEMP`, or a
   table declared temporary earlier in the same batch.

## Testing strategy

- `tests/unit` covers every module through fakes (`tests/helpers`): a fake
  pool with controllable health for the manager, a fake streaming request for
  the executor, a recording executor for the tools, and an in-memory MCP
  transport with the real client SDK for the server.
- `packages/*/tests/integration/live.test.ts` runs the real stack against a
  database when `RUN_INTEGRATION=1`, including a forced pool close to prove
  recovery; the PostgreSQL suite also kills its own backend with
  `pg_terminate_backend` and expects the next call to succeed.
