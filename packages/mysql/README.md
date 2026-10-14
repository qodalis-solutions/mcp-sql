# @qodalis/mcp-mysql

A resilient [Model Context Protocol](https://modelcontextprotocol.io) server for
MySQL and MariaDB, built for AI assistants such as Claude Code, Claude Desktop,
Cursor, Windsurf and VS Code.

It exists because most database MCP servers stop working after a network blip:
once the VPN drops they cache a dead connection pool and every later call fails
with `Connection lost` until the assistant is restarted. This server heals
itself instead.

## Highlights

- **Self-healing connections.** A failed connect is never cached, a disconnected
  pool is replaced on the next call, concurrent first calls share one connect,
  and queries retry once on connection loss (`PROTOCOL_CONNECTION_LOST`,
  `ECONNRESET`, server shutdown). After a VPN or network interruption you
  simply retry the call.
- **Read-only by default**, with a guard that still lets the assistant use
  `TEMPORARY` tables, CTEs, user variables and `SHOW` / `EXPLAIN`. Server-level
  statements such as `LOAD DATA`, `INTO OUTFILE`, `LOAD_FILE`, users, grants,
  `SET GLOBAL`, plugins, replication, `KILL` and `SHUTDOWN` are blocked in every
  mode.
- **Token-efficient results.** Columns are listed once, rows are arrays, results
  stream with a hard row cap and are flagged when truncated. Markdown and CSV
  on request.
- **Thirteen focused tools** for discovery (`search_objects`, `list_tables`,
  `describe_table`, `get_foreign_keys`, `get_object_definition`, ...) and
  querying (`execute_query` with named parameters, `sample_data`).
- **Several databases per server** through an allowlist, one pool per database.
- **Fast failure** when the host is unreachable (8 s connect timeout by
  default) instead of a long hang, with an error message that says what to do.
- Works with MySQL 8.0+, MariaDB 10.5+, Amazon RDS and Aurora MySQL, Azure
  Database for MySQL, Cloud SQL and PlanetScale.

## Quick start

```bash
npx -y @qodalis/mcp-mysql --help
```

### Claude Code

```bash
claude mcp add app-db -- npx -y @qodalis/mcp-mysql
```

then set the environment in `~/.claude.json` (or pass `-e` flags):

```json
{
  "mcpServers": {
    "app-db": {
      "command": "npx",
      "args": ["-y", "@qodalis/mcp-mysql"],
      "env": {
        "MYSQL_HOST": "db.example.com",
        "MYSQL_USER": "reader",
        "MYSQL_PASSWORD": "********",
        "MYSQL_DATABASE": "app",
        "MYSQL_SSL": "require"
      }
    }
  }
}
```

A single `MYSQL_URL` (`mysql://reader:secret@db.example.com:3306/app?ssl=require`)
works instead of the separate variables; explicit variables win over the URL.
`DATABASE_URL` is accepted as an alias.

### Claude Desktop, Cursor, Windsurf, VS Code

Use the same `command` / `args` / `env` block in `claude_desktop_config.json`,
`.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json` or `.vscode/mcp.json`
respectively. A `.env` file works too:

```json
{ "command": "npx", "args": ["-y", "@qodalis/mcp-mysql", "--env-file", "/path/to/.env"] }
```

Pin a version in production configs (`@qodalis/mcp-mysql@0.3.0`) so an
upgrade is a deliberate change.

## Configuration

Every setting is an environment variable. `MARIADB_*` names are accepted as
aliases for the same keys.

| Variable                   | Default  | Description                                                                                                                          |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `MYSQL_HOST`               | required | Host name or IP.                                                                                                                     |
| `MYSQL_PORT`               | `3306`   | TCP port.                                                                                                                            |
| `MYSQL_USER`               | required | User to connect as.                                                                                                                  |
| `MYSQL_PASSWORD`           | none     | Password (optional for socket or passwordless accounts). Redacted from every error.                                                  |
| `MYSQL_DATABASE`           | none     | Default database for every tool. Without it, unqualified names resolve against the connection's `database()`.                        |
| `MYSQL_DATABASES`          | none     | Comma-separated allowlist of databases the tools may target with their `database` argument. The default database is always included. |
| `MYSQL_URL`                | none     | `mysql://user:pass@host:port/db?ssl=require`; fills in whatever the variables above leave unset.                                     |
| `MYSQL_SSL`                | `false`  | `false` (plain TCP), `require` (TLS, certificate not verified) or `verify` (TLS with a trusted certificate).                         |
| `MYSQL_READ_ONLY`          | `true`   | Reject persistent writes and DDL. See [read-only mode](#read-only-mode).                                                             |
| `MYSQL_MAX_ROWS`           | `1000`   | Hard cap on rows returned by any tool.                                                                                               |
| `MYSQL_CONNECTION_TIMEOUT` | `8000`   | Milliseconds to wait for a connection before failing.                                                                                |
| `MYSQL_REQUEST_TIMEOUT`    | `30000`  | Milliseconds a single query may run (driver-side timeout).                                                                           |
| `MYSQL_POOL_MAX`           | `10`     | Connections per database pool.                                                                                                       |
| `MYSQL_QUERY_LOG`          | `false`  | Log every statement to stderr.                                                                                                       |
| `MYSQL_ENV_FILE`           | none     | Path to a `.env` file (same as `--env-file`).                                                                                        |

## Tools

| Tool                    | Purpose                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test_connection`       | Proves connectivity with a real query; reports server, database, login, server time and pool state. Never throws: returns `ok: false` with a hint instead.   |
| `get_server_info`       | Version and edition, host, character set, time zone, connection limit, current database and login.                                                           |
| `list_databases`        | Databases visible to the login, system databases hidden.                                                                                                     |
| `list_tables`           | Base tables with engine, estimated row count, size and comment; filter by name. Defaults to the current database.                                            |
| `list_views`            | Views with definer and updatability; filter by name.                                                                                                         |
| `list_procedures`       | Stored procedures and functions with arguments and return type; filter by kind or name.                                                                      |
| `describe_table`        | Columns with full types, nullability, auto-increment, generated flag, default, key and comment; indexes with their columns; foreign keys in both directions. |
| `get_foreign_keys`      | Relationships for one table or a whole database, with columns and referential actions.                                                                       |
| `get_table_stats`       | Row estimate, data/index/free size, next auto-increment and timestamps for one table or the largest tables.                                                  |
| `get_object_definition` | SQL source of a view, procedure, function or trigger.                                                                                                        |
| `search_objects`        | Find tables, views, routines and columns by name substring across every user database.                                                                       |
| `sample_data`           | First or random rows from a table, optionally a column subset.                                                                                               |
| `execute_query`         | Run SQL with named parameters; JSON, Markdown or CSV output.                                                                                                 |

Full argument reference: [docs/tools.md](../../docs/tools.md).

On MySQL "schema" and "database" are the same thing: the `schema` argument of
the catalog tools names a database and defaults to `MYSQL_DATABASE`. Named
parameters are written as `@name` in the SQL and rewritten to `?` placeholders
before execution, so `@@version` and `@user_variable` in a query without
params are left alone (a query that uses params cannot also use user
variables). Multi-statement batches are supported; `bigint` values that fit a
JavaScript number are returned as numbers, `decimal` values as strings.

## Read-only mode

With `MYSQL_READ_ONLY=true` (the default) `execute_query` accepts:

- `SELECT`, `WITH ... SELECT`, `EXPLAIN`, `SHOW`, `DESCRIBE`, `SET @var` /
  `SET SESSION`, transactions;
- writes whose only targets are temporary tables (`CREATE TEMPORARY TABLE`),
  including `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` and `DROP` on a table
  declared temporary earlier in the same batch.

It rejects `INSERT`/`UPDATE`/`DELETE`/`REPLACE` on persistent tables, DDL,
`CALL`, `DO`, `HANDLER`, `LOCK TABLES`, `OPTIMIZE`/`REPAIR`/`ANALYZE TABLE`
and `RENAME`. The guard strips comments (`--`, `#`, `/* */`), string literals
and backtick identifiers before matching so neither hidden nor quoted keywords
confuse it.

### Write mode

Set `MYSQL_READ_ONLY=false` on a server entry to let `execute_query` run
`INSERT`, `UPDATE`, `DELETE`, `REPLACE`, `CALL` and DDL. Even then the
server-level statements listed above stay blocked, and MySQL still enforces the
user's own privileges: the guard can only ever be stricter than the user, never
looser. Give write-enabled servers a distinct name in your client config so
using one is a deliberate choice.

The guard is defence in depth. Always connect with a least-privilege user as
well.

## How reconnection works

The mysql2 pool is wrapped by a `PoolManager` that treats every pool as
disposable:

1. `connect()` failures are not cached; the next call creates a new pool.
2. Before reuse the pool must report `connected`; otherwise it is closed and
   replaced.
3. Concurrent first calls await a single in-flight connect.
4. Each query runs through `withRetry`: a connection-level error
   (`PROTOCOL_CONNECTION_LOST`, `ECONNRESET`, `ETIMEDOUT`, `ER_SERVER_SHUTDOWN`,
   DNS failure) discards the pool and retries exactly once on a fresh one. SQL
   errors and `ER_ACCESS_DENIED_ERROR` are never retried.
5. A query that hits the row cap destroys its connection instead of returning
   it to the pool, which is the only way to stop the server from sending the
   remaining rows; the pool opens a fresh one on demand.

Details and the failure modes this covers: [docs/architecture.md](../../docs/architecture.md).

## Library use

The pieces are exported for embedding:

```ts
import {
  MysqlExecutor,
  PoolManager,
  createMysqlPool,
  createMysqlServer,
  loadConfig,
} from '@qodalis/mcp-mysql';

const config = loadConfig(process.env);
const manager = new PoolManager({ createPool: createMysqlPool(config) });
const executor = new MysqlExecutor(manager, { maxRows: config.maxRows });
const server = createMysqlServer({ config, executor, poolState: (db) => manager.describe(db) });
```

## Development

```bash
npm install
npm test                 # unit tests, no database required
npm run test:integration # live tests, needs RUN_INTEGRATION=1 and MYSQL_* set
npm run typecheck
npm run build
npx tsx scripts/check-reconnect.mts   # proves recovery from a network drop, no root needed
```

A disposable server for the live tests:

```bash
docker run -d --name mcp-sql-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_USER=mcp -e MYSQL_PASSWORD=mcp -e MYSQL_DATABASE=mcp -p 3306:3306 mysql:8.4
MYSQL_HOST=127.0.0.1 MYSQL_USER=mcp MYSQL_PASSWORD=mcp MYSQL_DATABASE=mcp npm run test:integration
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

[MIT](LICENSE) © Qodalis Solutions SRL
