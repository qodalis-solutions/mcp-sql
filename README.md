# @qodalis/mcp-sqlserver

A resilient [Model Context Protocol](https://modelcontextprotocol.io) server for
Microsoft SQL Server, built for AI assistants such as Claude Code, Claude
Desktop, Cursor, Windsurf and VS Code.

It exists because most SQL Server MCP servers stop working after a network blip:
once the VPN drops they cache a dead connection pool and every later call fails
with `Connection is closed` until the assistant is restarted. This server heals
itself instead.

## Highlights

- **Self-healing connections.** A failed connect is never cached, a disconnected
  pool is replaced on the next call, pool errors discard the pool, concurrent
  first calls share one connect, and queries retry once on connection loss.
  After a VPN or network interruption you simply retry the call.
- **Read-only by default**, with a guard that still lets the assistant use
  `#temp` tables, table variables and CTEs. Server-level statements such as
  `xp_cmdshell`, backups, logins and configuration are blocked in every mode.
- **Token-efficient results.** Columns are listed once, rows are arrays, results
  stream with a hard row cap and are flagged when truncated. Markdown and CSV
  on request.
- **Thirteen focused tools** for discovery (`search_objects`, `list_tables`,
  `describe_table`, `get_foreign_keys`, `get_object_definition`, ...) and
  querying (`execute_query` with named parameters, `sample_data`).
- **Several databases per server** through an allowlist, one pool per database.
- **Fast failure** when the host is unreachable (8 s connect timeout by
  default) instead of a 30 s hang, with an error message that says what to do.
- Works with SQL Server 2016+, Azure SQL Database, Amazon RDS for SQL Server
  and Fabric SQL. SQL and NTLM authentication.

## Quick start

```bash
npx -y @qodalis/mcp-sqlserver --help
```

### Claude Code

```bash
claude mcp add sales -- npx -y @qodalis/mcp-sqlserver
```

then set the environment in `~/.claude.json` (or pass `-e` flags):

```json
{
  "mcpServers": {
    "sales": {
      "command": "npx",
      "args": ["-y", "@qodalis/mcp-sqlserver"],
      "env": {
        "SQLSERVER_HOST": "db.example.com",
        "SQLSERVER_USER": "reader",
        "SQLSERVER_PASSWORD": "********",
        "SQLSERVER_DATABASE": "Sales",
        "SQLSERVER_ENCRYPT": "true",
        "SQLSERVER_TRUST_CERT": "true"
      }
    }
  }
}
```

### Claude Desktop, Cursor, Windsurf, VS Code

Use the same `command` / `args` / `env` block in `claude_desktop_config.json`,
`.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json` or `.vscode/mcp.json`
respectively. A `.env` file works too:

```json
{ "command": "npx", "args": ["-y", "@qodalis/mcp-sqlserver", "--env-file", "/path/to/.env"] }
```

Pin a version in production configs (`@qodalis/mcp-sqlserver@0.1.0`) so an
upgrade is a deliberate change.

## Configuration

Every setting is an environment variable. `MSSQL_*` names are accepted as
fallbacks for the same keys, so configs written for other SQL Server MCP
servers keep working.

| Variable                       | Default        | Description                                                                                                                          |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `SQLSERVER_HOST`               | required       | Host name or IP.                                                                                                                     |
| `SQLSERVER_PORT`               | `1433`         | TCP port.                                                                                                                            |
| `SQLSERVER_USER`               | required       | SQL login (or Windows user with `SQLSERVER_DOMAIN`).                                                                                 |
| `SQLSERVER_PASSWORD`           | required       | Password. Redacted from every error.                                                                                                 |
| `SQLSERVER_DATABASE`           | server default | Default database for every tool.                                                                                                     |
| `SQLSERVER_DATABASES`          | none           | Comma-separated allowlist of databases the tools may target with their `database` argument. The default database is always included. |
| `SQLSERVER_DOMAIN`             | none           | Enables NTLM authentication with this domain.                                                                                        |
| `SQLSERVER_ENCRYPT`            | `true`         | TLS for the connection.                                                                                                              |
| `SQLSERVER_TRUST_CERT`         | `false`        | Trust a self-signed server certificate.                                                                                              |
| `SQLSERVER_READ_ONLY`          | `true`         | Reject persistent writes and DDL. See [read-only mode](#read-only-mode).                                                             |
| `SQLSERVER_MAX_ROWS`           | `1000`         | Hard cap on rows returned by any tool.                                                                                               |
| `SQLSERVER_CONNECTION_TIMEOUT` | `8000`         | Milliseconds to wait for a connection before failing.                                                                                |
| `SQLSERVER_REQUEST_TIMEOUT`    | `30000`        | Milliseconds a single query may run.                                                                                                 |
| `SQLSERVER_POOL_MAX`           | `10`           | Connections per database pool.                                                                                                       |
| `SQLSERVER_USE_UTC`            | `true`         | Read `datetime` values as UTC (`false` uses the server's local time).                                                                |
| `SQLSERVER_QUERY_LOG`          | `false`        | Log every statement to stderr.                                                                                                       |
| `SQLSERVER_ENV_FILE`           | none           | Path to a `.env` file (same as `--env-file`).                                                                                        |

## Tools

| Tool                    | Purpose                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_connection`       | Proves connectivity with a real query; reports server, database, login, server time and pool state. Never throws: returns `ok: false` with a hint instead. |
| `get_server_info`       | Version, edition, collation, machine and instance names.                                                                                                   |
| `list_databases`        | Databases visible to the login.                                                                                                                            |
| `list_tables`           | User tables with approximate row counts; filter by schema or name.                                                                                         |
| `list_views`            | Views; filter by schema or name.                                                                                                                           |
| `list_procedures`       | Stored procedures and functions; filter by kind, schema or name.                                                                                           |
| `describe_table`        | Columns with full types, defaults, identity and computed flags; indexes with key and included columns; foreign keys in both directions.                    |
| `get_foreign_keys`      | Relationships for one table or the whole database, with columns and referential actions.                                                                   |
| `get_table_stats`       | Row count and reserved/data/index size for one table or the largest tables.                                                                                |
| `get_object_definition` | T-SQL source of a view, procedure, function or trigger.                                                                                                    |
| `search_objects`        | Find tables, views, routines and columns by name substring.                                                                                                |
| `sample_data`           | First or random rows from a table, optionally a column subset.                                                                                             |
| `execute_query`         | Run T-SQL with named parameters; JSON, Markdown or CSV output.                                                                                             |

Full argument reference: [docs/tools.md](docs/tools.md).

## Read-only mode

With `SQLSERVER_READ_ONLY=true` (the default) `execute_query` accepts:

- `SELECT`, `WITH ... SELECT`, `DECLARE`, `SET`, `PRINT`, `IF`/`BEGIN`/`END`;
- writes whose only targets are `#temp` tables or `@table` variables, including
  `SELECT ... INTO #tmp`, `CREATE TABLE #tmp`, `INSERT`, `UPDATE`, `DELETE`,
  `TRUNCATE` and `DROP` on them.

It rejects `INSERT`/`UPDATE`/`DELETE`/`MERGE` on persistent tables, DDL,
`EXEC`, `DBCC`, `WAITFOR`, permission changes and global `##temp` tables. The
guard strips comments and string literals before matching so neither hidden nor
quoted keywords confuse it.

### Write mode

Set `SQLSERVER_READ_ONLY=false` on a server entry to let `execute_query` run
`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `EXEC` and DDL. Even then the
server-level statements listed above stay blocked, and SQL Server still enforces
the login's own permissions: the guard can only ever be stricter than the login,
never looser. Give write-enabled servers a distinct name in your client config so
using one is a deliberate choice.

The guard is defence in depth. Always connect with a least-privilege login as
well.

## How reconnection works

The driver pool is wrapped by a `PoolManager` that treats every pool as
disposable:

1. `connect()` failures are not cached; the next call creates a new pool.
2. Before reuse the pool must report `connected`; otherwise it is closed and
   replaced.
3. The pool's `error` event discards it (late events from an already replaced
   pool are ignored).
4. Concurrent first calls await a single in-flight connect.
5. Each query runs through `withRetry`: a connection-level error (socket reset,
   `Connection is closed`, connect timeout, DNS failure) discards the pool and
   retries exactly once on a fresh one. SQL errors and login failures are never
   retried.
6. Pooled connections are validated by the driver before use, so sockets that
   died while idle are replaced transparently.

Details and the failure modes this covers: [docs/architecture.md](docs/architecture.md).

## Library use

The pieces are exported for embedding:

```ts
import {
  PoolManager,
  SqlExecutor,
  createMssqlPool,
  createServer,
  loadConfig,
} from '@qodalis/mcp-sqlserver';

const config = loadConfig(process.env);
const manager = new PoolManager({ createPool: createMssqlPool(config) });
const executor = new SqlExecutor(manager, { maxRows: config.maxRows });
const server = createServer({ config, executor, poolState: (db) => manager.describe(db) });
```

## Development

```bash
npm install
npm test                 # unit tests, no database required
npm run test:integration # live tests, needs RUN_INTEGRATION=1 and SQLSERVER_* set
npm run typecheck
npm run build
npx tsx scripts/check-reconnect.mts   # proves recovery from a network drop, no root needed
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Qodalis Solutions SRL
