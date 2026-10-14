# Architecture

```
cli.ts ─── serveStdio ─── McpServer (server.ts)
                               │  registerTool × 13 (tools/*.ts)
                               ▼
                          ToolContext { config, executor, poolState, signal }
                               │
                        SqlExecutor (sql/executor.ts)
                               │  withRetry
                        PoolManager (sql/pool-manager.ts)
                               │  createPool(database)
                      mssql.ConnectionPool (sql/mssql-pool.ts)
```

Supporting modules: `config.ts` (environment parsing), `env-file.ts`,
`sql/guard.ts` (statement guard), `sql/identifiers.ts` (safe object names),
`sql/errors.ts` (classification and redaction), `format.ts` (json/markdown/csv).

## Why a pool manager

`mssql.ConnectionPool` has three states that matter: `connecting`, `connected`
and closed. A naive server does

```ts
if (!this.pool) { this.pool = new ConnectionPool(cfg); await this.pool.connect(); }
```

If `connect()` throws (host unreachable while the VPN is down) `this.pool` is
already assigned, every later call skips the connect, and `pool.request()`
throws `Connection is closed` forever. The same happens when the pool emits
`error` after the network drops. Only a process restart fixes it.

`PoolManager` makes pools disposable:

| Situation | Behaviour |
| --- | --- |
| First call | Create pool, `connect()`, cache only on success. |
| `connect()` throws | Close the half-built pool, do not cache, rethrow. Next call starts over. |
| Cached pool reports `connected === false` | Close it, create a new one. |
| Pool emits `error` | Discard it if it is still the current pool; ignore if it was already replaced. |
| Two calls arrive while connecting | Both await the same in-flight promise. |
| Query fails with a connection-level error | Discard the pool, reconnect, run the query once more. |
| Query fails with a SQL error or login failure | Propagate immediately, no retry. |
| Shutdown | Close every pool, swallowing close errors. |

`isConnectionError` recognises the driver codes (`ESOCKET`, `ECONNCLOSED`,
`ENOTOPEN`, `ETIMEOUT`, `ECONNRESET`, `EPIPE`, `ENOTFOUND`, ...) and the
corresponding messages, walking `originalError` when present. `ELOGIN` is
explicitly excluded so a bad password does not loop.

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

## Statement guard

`scrubSql` removes `--` and `/* */` comments and blanks string literals and
quoted identifiers while preserving positions. `validateSql` then matches:

1. always-blocked patterns (command execution, configuration, backup/restore,
   logins, linked servers, bulk operations);
2. in read-only mode, blocked keywords (`MERGE`, `ALTER`, `EXEC`, `DBCC`,
   `WAITFOR`, permissions, non-table `CREATE`/`DROP`/`TRUNCATE`);
3. in read-only mode, targeted writes (`INSERT`, `UPDATE`, `DELETE`,
   `CREATE TABLE`, `DROP TABLE`, `TRUNCATE TABLE`, `SELECT ... INTO`) whose
   target must start with `#` (not `##`) or `@`.

## Testing strategy

- `tests/unit` covers every module through fakes (`tests/helpers`): a fake
  pool with controllable health for the manager, a fake streaming request for
  the executor, a recording executor for the tools, and an in-memory MCP
  transport with the real client SDK for the server.
- `tests/integration/live.test.ts` runs the real stack against a database when
  `RUN_INTEGRATION=1`, including a forced pool close to prove recovery.
