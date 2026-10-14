# @qodalis/mcp-postgres

A resilient [Model Context Protocol](https://modelcontextprotocol.io) server for
PostgreSQL, built for AI assistants such as Claude Code, Claude Desktop, Cursor,
Windsurf and VS Code.

It exists because most database MCP servers stop working after a network blip:
once the VPN drops they cache a dead connection pool and every later call fails
with `Connection terminated` until the assistant is restarted. This server heals
itself instead.

## Highlights

- **Self-healing connections.** A failed connect is never cached, a disconnected
  pool is replaced on the next call, pool errors discard the pool, concurrent
  first calls share one connect, and queries retry once on connection loss.
  After a VPN or network interruption you simply retry the call.
- **Read-only by default**, with a guard that still lets the assistant use
  `TEMP` tables, CTEs and `pg_temp`. Server-level statements such as
  `COPY ... PROGRAM`, `pg_read_file`, roles, databases, extensions and
  `ALTER SYSTEM` are blocked in every mode.
- **Token-efficient results.** Columns are listed once, rows are arrays, results
  stream through a server-side cursor with a hard row cap and are flagged when
  truncated. Markdown and CSV on request.
- **Thirteen focused tools** for discovery (`search_objects`, `list_tables`,
  `describe_table`, `get_foreign_keys`, `get_object_definition`, ...) and
  querying (`execute_query` with named parameters, `sample_data`).
- **Several databases per server** through an allowlist, one pool per database.
- **Fast failure** when the host is unreachable (8 s connect timeout by
  default) instead of a long hang, with an error message that says what to do.
- Works with PostgreSQL 12+, Amazon RDS and Aurora PostgreSQL, Azure Database
  for PostgreSQL, Cloud SQL, Neon, Supabase and Timescale.

## Quick start

```bash
npx -y @qodalis/mcp-postgres --help
```

### Claude Code

```bash
claude mcp add app-db -- npx -y @qodalis/mcp-postgres
```

then set the environment in `~/.claude.json` (or pass `-e` flags):

```json
{
  "mcpServers": {
    "app-db": {
      "command": "npx",
      "args": ["-y", "@qodalis/mcp-postgres"],
      "env": {
        "POSTGRES_HOST": "db.example.com",
        "POSTGRES_USER": "reader",
        "POSTGRES_PASSWORD": "********",
        "POSTGRES_DATABASE": "app",
        "POSTGRES_SSL": "require"
      }
    }
  }
}
```

A single `POSTGRES_URL` (`postgresql://reader:secret@db.example.com:5432/app?sslmode=require`)
works instead of the separate variables; explicit variables win over the URL.
`DATABASE_URL` is accepted as an alias.

### Claude Desktop, Cursor, Windsurf, VS Code

Use the same `command` / `args` / `env` block in `claude_desktop_config.json`,
`.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json` or `.vscode/mcp.json`
respectively. A `.env` file works too:

```json
{ "command": "npx", "args": ["-y", "@qodalis/mcp-postgres", "--env-file", "/path/to/.env"] }
```

Pin a version in production configs (`@qodalis/mcp-postgres@0.2.0`) so an
upgrade is a deliberate change.

## Configuration

Every setting is an environment variable. The libpq names `PGHOST`, `PGPORT`,
`PGUSER`, `PGPASSWORD`, `PGDATABASE` and `PGSSLMODE` are accepted as fallbacks,
so an environment that already works for `psql` works here.

| Variable                      | Default                | Description                                                                                                                          |
| ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_HOST`               | required               | Host name or IP.                                                                                                                     |
| `POSTGRES_PORT`               | `5432`                 | TCP port.                                                                                                                            |
| `POSTGRES_USER`               | required               | Role to connect as.                                                                                                                  |
| `POSTGRES_PASSWORD`           | none                   | Password (optional for `trust` or certificate authentication). Redacted from every error.                                            |
| `POSTGRES_DATABASE`           | role default           | Default database for every tool.                                                                                                     |
| `POSTGRES_DATABASES`          | none                   | Comma-separated allowlist of databases the tools may target with their `database` argument. The default database is always included. |
| `POSTGRES_URL`                | none                   | `postgresql://user:pass@host:port/db?sslmode=...`; fills in whatever the variables above leave unset.                                |
| `POSTGRES_SSL`                | `require`              | `false` (plain TCP), `require` (TLS, certificate not verified) or `verify` (TLS with a trusted certificate).                         |
| `POSTGRES_READ_ONLY`          | `true`                 | Reject persistent writes and DDL. See [read-only mode](#read-only-mode).                                                             |
| `POSTGRES_MAX_ROWS`           | `1000`                 | Hard cap on rows returned by any tool.                                                                                               |
| `POSTGRES_CONNECTION_TIMEOUT` | `8000`                 | Milliseconds to wait for a connection before failing.                                                                                |
| `POSTGRES_REQUEST_TIMEOUT`    | `30000`                | Milliseconds a single statement may run (`statement_timeout`).                                                                       |
| `POSTGRES_POOL_MAX`           | `10`                   | Connections per database pool.                                                                                                       |
| `POSTGRES_APPLICATION_NAME`   | `qodalis-mcp-postgres` | Shown in `pg_stat_activity`.                                                                                                         |
| `POSTGRES_QUERY_LOG`          | `false`                | Log every statement to stderr.                                                                                                       |
| `POSTGRES_ENV_FILE`           | none                   | Path to a `.env` file (same as `--env-file`).                                                                                        |

## Tools

| Tool                    | Purpose                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_connection`       | Proves connectivity with a real query; reports server, database, login, server time and pool state. Never throws: returns `ok: false` with a hint instead. |
| `get_server_info`       | Version, encoding, time zone, address, uptime and whether the server is a replica.                                                                         |
| `list_databases`        | Databases on the server with owner, encoding and size (templates hidden).                                                                                  |
| `list_tables`           | Tables and partitioned tables with estimated row counts, size and comment; filter by schema or name.                                                       |
| `list_views`            | Views and materialized views; filter by schema or name.                                                                                                    |
| `list_procedures`       | Functions and procedures with language, arguments and return type; filter by kind, schema or name.                                                         |
| `describe_table`        | Columns with full types, defaults, identity and generated flags; indexes with definition and size; foreign keys in both directions.                        |
| `get_foreign_keys`      | Relationships for one table or the whole database, with columns and referential actions.                                                                   |
| `get_table_stats`       | Row estimate, dead rows, data/index/TOAST size and vacuum timestamps for one table or the largest tables.                                                  |
| `get_object_definition` | SQL source of a view, materialized view, function, procedure or trigger.                                                                                   |
| `search_objects`        | Find tables, views, routines and columns by name substring.                                                                                                |
| `sample_data`           | First or random rows from a table, optionally a column subset.                                                                                             |
| `execute_query`         | Run SQL with named parameters; JSON, Markdown or CSV output.                                                                                               |

Full argument reference: [docs/tools.md](../../docs/tools.md).

Named parameters are written as `@name` in the SQL and are rewritten to
positional `$n` placeholders before execution, so `@id` in a string literal or
a `@>` operator is left alone. A multi-statement batch runs through the simple
protocol, which PostgreSQL requires for it; such a batch cannot carry parameters.

## Read-only mode

With `POSTGRES_READ_ONLY=true` (the default) `execute_query` accepts:

- `SELECT`, `WITH ... SELECT`, `VALUES`, `EXPLAIN`, `SHOW`, `SET`/`RESET`,
  `BEGIN`/`COMMIT`/`ROLLBACK`;
- writes whose only targets are temporary tables (`CREATE TEMP TABLE`,
  `SELECT ... INTO TEMP`, anything in `pg_temp`), including `INSERT`, `UPDATE`,
  `DELETE`, `TRUNCATE` and `DROP` on a table declared temporary earlier in the
  same batch.

It rejects `INSERT`/`UPDATE`/`DELETE`/`MERGE` on persistent tables, DDL,
`CALL`, `DO`, `COPY`, `VACUUM`, `REFRESH MATERIALIZED VIEW`, `LOCK`,
`LISTEN`/`NOTIFY` and permission changes. The guard strips comments, string
literals, dollar-quoted bodies and quoted identifiers before matching so neither
hidden nor quoted keywords confuse it.

### Write mode

Set `POSTGRES_READ_ONLY=false` on a server entry to let `execute_query` run
`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `CALL`, `DO` and DDL. Even then the
server-level statements listed above stay blocked, and PostgreSQL still enforces
the role's own privileges: the guard can only ever be stricter than the role,
never looser. Give write-enabled servers a distinct name in your client config so
using one is a deliberate choice.

The guard is defence in depth. Always connect with a least-privilege role as
well.

## How reconnection works

`pg.Pool` is wrapped by a `PoolManager` that treats every pool as disposable:

1. `connect()` failures are not cached; the next call creates a new pool.
2. Before reuse the pool must report `connected`; otherwise it is closed and
   replaced.
3. The pool's `error` event (an idle client dying after a network drop) discards
   it; late events from an already replaced pool are ignored.
4. Concurrent first calls await a single in-flight connect.
5. Each query runs through `withRetry`: a connection-level error (socket reset,
   `Connection terminated`, connect timeout, DNS failure, `57P01` admin
   shutdown) discards the pool and retries exactly once on a fresh one. SQL
   errors and authentication failures are never retried.

Details and the failure modes this covers: [docs/architecture.md](../../docs/architecture.md).

## Library use

The pieces are exported for embedding:

```ts
import {
  PgExecutor,
  PoolManager,
  createPgPool,
  createPostgresServer,
  loadConfig,
} from '@qodalis/mcp-postgres';

const config = loadConfig(process.env);
const manager = new PoolManager({ createPool: createPgPool(config) });
const executor = new PgExecutor(manager, { maxRows: config.maxRows });
const server = createPostgresServer({ config, executor, poolState: (db) => manager.describe(db) });
```

## Development

```bash
npm install
npm test                 # unit tests, no database required
npm run test:integration # live tests, needs RUN_INTEGRATION=1 and POSTGRES_* set
npm run typecheck
npm run build
npx tsx scripts/check-reconnect.mts   # proves recovery from a network drop, no root needed
```

A disposable server for the live tests:

```bash
docker run -d --name mcp-sql-postgres -e POSTGRES_USER=mcp -e POSTGRES_PASSWORD=mcp -e POSTGRES_DB=mcp -p 5432:5432 postgres:17-alpine
POSTGRES_HOST=localhost POSTGRES_USER=mcp POSTGRES_PASSWORD=mcp POSTGRES_DATABASE=mcp POSTGRES_SSL=false npm run test:integration
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

[MIT](LICENSE) © Qodalis Solutions SRL
