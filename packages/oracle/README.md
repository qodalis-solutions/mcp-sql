# @qodalis/mcp-oracle

A resilient [Model Context Protocol](https://modelcontextprotocol.io) server for
Oracle Database, built for AI assistants such as Claude Code, Claude Desktop,
Cursor, Windsurf and VS Code. Uses the `oracledb` driver in thin mode, so no
Oracle Client libraries are needed.

It exists because most database MCP servers stop working after a network blip:
once the VPN drops they cache a dead connection pool and every later call fails
until the assistant is restarted. This server heals itself instead.

## Highlights

- **Self-healing connections.** A failed connect is never cached, a disconnected
  pool is replaced on the next call, concurrent first calls share one connect,
  and queries retry once on connection loss (`ORA-03113`, `ORA-03114`,
  `ORA-12541`, `NJS-500`, ...). After a VPN or network interruption you simply
  retry the call.
- **Read-only by default**, with a guard that still lets the assistant use
  private temporary tables (`ORA$PTT_*`), CTEs and `ALTER SESSION SET
CURRENT_SCHEMA`. Nothing is ever committed in read-only mode: statements run
  without autocommit and the session is rolled back before it returns to the
  pool. `UTL_FILE`, `UTL_HTTP`, `DBMS_SCHEDULER`, users, roles, database links,
  directories, `ALTER SYSTEM` and `EXECUTE IMMEDIATE` are blocked in every mode.
- **Token-efficient results.** Columns are listed once, rows are arrays, results
  stream through a server-side cursor with a hard row cap and are flagged when
  truncated. Markdown and CSV on request.
- **Thirteen focused tools** for discovery (`search_objects`, `list_tables`,
  `describe_table`, `get_foreign_keys`, `get_object_definition`, ...) and
  querying (`execute_query` with named binds, `sample_data`).
- **Several schemas per server** through an allowlist. An Oracle session lives
  in one database, so the `database` argument of every tool selects a
  **schema**; see [schemas](#schemas-and-the-database-argument).
- **Fast failure** when the host is unreachable (8 s connect timeout by
  default), with an error message that says what to do.
- Works with Oracle Database 12.2+, 19c, 21c, 23ai (including Free) and
  Autonomous Database (wallet or TLS connect strings). Private temporary
  tables need 18c+.

## Quick start

```bash
npx -y @qodalis/mcp-oracle --help
```

### Claude Code

```bash
claude mcp add erp -- npx -y @qodalis/mcp-oracle
```

then set the environment in `~/.claude.json` (or pass `-e` flags):

```json
{
  "mcpServers": {
    "erp": {
      "command": "npx",
      "args": ["-y", "@qodalis/mcp-oracle"],
      "env": {
        "ORACLE_HOST": "db.example.com",
        "ORACLE_SERVICE": "ORCLPDB1",
        "ORACLE_USER": "reader",
        "ORACLE_PASSWORD": "********",
        "ORACLE_DATABASE": "HR"
      }
    }
  }
}
```

A full connect string works instead of host, port and service, which is how
Autonomous Database and TNS setups are usually described:

```json
{
  "ORACLE_CONNECT_STRING": "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=adb.eu-frankfurt-1.oraclecloud.com)(PORT=1522))(CONNECT_DATA=(SERVICE_NAME=xxx_high.adb.oraclecloud.com)))"
}
```

`ORACLE_URL=oracle://user:pass@host:port/service` is accepted too; explicit
variables win over both.

### Claude Desktop, Cursor, Windsurf, VS Code

Use the same `command` / `args` / `env` block in `claude_desktop_config.json`,
`.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json` or `.vscode/mcp.json`
respectively. A `.env` file works too:

```json
{ "command": "npx", "args": ["-y", "@qodalis/mcp-oracle", "--env-file", "/path/to/.env"] }
```

Pin a version in production configs (`@qodalis/mcp-oracle@0.3.0`) so an
upgrade is a deliberate change.

## Configuration

Every setting is an environment variable.

| Variable                    | Default    | Description                                                                                                                  |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ORACLE_HOST`               | required\* | Host name or IP.                                                                                                             |
| `ORACLE_PORT`               | `1521`     | Listener port.                                                                                                               |
| `ORACLE_SERVICE`            | required\* | Service name (`ORCLPDB1`, `FREEPDB1`, ...).                                                                                  |
| `ORACLE_CONNECT_STRING`     | none       | EZConnect (`host:port/service`) or a TNS descriptor. Replaces the three above.                                               |
| `ORACLE_URL`                | none       | `oracle://user:pass@host:port/service`; fills in whatever the variables leave unset.                                         |
| `ORACLE_USER`               | required   | Login.                                                                                                                       |
| `ORACLE_PASSWORD`           | required   | Password. Redacted from every error.                                                                                         |
| `ORACLE_DATABASE`           | the user   | Default **schema** for object lookups (alias `ORACLE_SCHEMA`). Unquoted names are upper-cased.                               |
| `ORACLE_DATABASES`          | none       | Comma-separated allowlist of schemas the tools may target with their `database`/`schema` arguments (alias `ORACLE_SCHEMAS`). |
| `ORACLE_WALLET_LOCATION`    | none       | Directory holding `cwallet.sso` / `ewallet.pem` for mTLS (Autonomous Database).                                              |
| `ORACLE_WALLET_PASSWORD`    | none       | Wallet password when the wallet is encrypted.                                                                                |
| `ORACLE_READ_ONLY`          | `true`     | Reject persistent writes and DDL. See [read-only mode](#read-only-mode).                                                     |
| `ORACLE_MAX_ROWS`           | `1000`     | Hard cap on rows returned by any tool.                                                                                       |
| `ORACLE_CONNECTION_TIMEOUT` | `8000`     | Milliseconds to wait for a connection before failing.                                                                        |
| `ORACLE_REQUEST_TIMEOUT`    | `30000`    | Milliseconds a single round trip may take (`callTimeout`).                                                                   |
| `ORACLE_POOL_MAX`           | `10`       | Connections in the pool.                                                                                                     |
| `ORACLE_QUERY_LOG`          | `false`    | Log every statement to stderr.                                                                                               |
| `ORACLE_ENV_FILE`           | none       | Path to a `.env` file (same as `--env-file`).                                                                                |

\* unless `ORACLE_CONNECT_STRING` or `ORACLE_URL` is given.

### Schemas and the `database` argument

Oracle has no `USE database`: a session is bound to one database (or pluggable
database) and objects live in schemas. The shared tool argument `database`
therefore selects a **schema** here, `ORACLE_DATABASE` is the default schema
and `ORACLE_DATABASES` the schema allowlist. `list_databases` lists schemas.
Table names given to `describe_table`, `sample_data`, `get_object_definition`
and `get_foreign_keys` may be schema-qualified (`HR.EMPLOYEES`); unquoted
names are upper-cased the way Oracle does, quoted names keep their case.

## Tools

| Tool                    | Purpose                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_connection`       | Proves connectivity with a real query; reports database, login, server time and pool state. Never throws: returns `ok: false` with a hint instead. |
| `get_server_info`       | Version, database and container names, instance, host, time zones, session user and current schema.                                                |
| `list_databases`        | Schemas (users) on the instance; Oracle-maintained ones hidden by default.                                                                         |
| `list_tables`           | Tables of a schema with optimizer row estimates, last statistics time and comment; filter by name.                                                 |
| `list_views`            | Views and materialized views of a schema; filter by name.                                                                                          |
| `list_procedures`       | Stand-alone procedures, functions and packages with validity status; filter by kind or name.                                                       |
| `describe_table`        | Columns with full types, defaults, identity and virtual flags; indexes with columns and uniqueness; foreign keys in both directions.               |
| `get_foreign_keys`      | Relationships for one table or a whole schema, with columns and delete rule.                                                                       |
| `get_table_stats`       | Row estimate, blocks, average row length, segment size (own schema), index count, last analyzed, for one table or the largest tables.              |
| `get_object_definition` | Source of a view, materialized view, procedure, function, package (spec and body), trigger or type.                                                |
| `search_objects`        | Find tables, views, routines, packages, triggers, sequences and columns by name substring.                                                         |
| `sample_data`           | First or random rows from a table, optionally a column subset.                                                                                     |
| `execute_query`         | Run SQL with named binds; JSON, Markdown or CSV output.                                                                                            |

Full argument reference: [docs/tools.md](../../docs/tools.md).

Named parameters are written as `@name` in the SQL and are passed to Oracle as
`:name` binds (booleans travel as 1/0, objects as JSON). A batch of several
statements separated by `;` runs sequentially on one session, so a private
temporary table created in the first statement is visible to the next; such a
batch cannot carry parameters. `NUMBER` values arrive as JavaScript numbers
(precision beyond 2^53 is lost), `DATE`/`TIMESTAMP` as ISO strings, `CLOB` as
text, `BLOB`/`RAW` as hex.

## Read-only mode

With `ORACLE_READ_ONLY=true` (the default) `execute_query` accepts:

- `SELECT`, `WITH ... SELECT`, `EXPLAIN PLAN`, `ROLLBACK`, `ALTER SESSION SET
CURRENT_SCHEMA` / `NLS_*`;
- writes whose only targets are private temporary tables (names starting with
  `ORA$PTT_`): `CREATE PRIVATE TEMPORARY TABLE`, `INSERT`, `UPDATE`, `DELETE`,
  `TRUNCATE` and `DROP` on them.

It rejects `INSERT`/`UPDATE`/`DELETE`/`MERGE` on persistent tables, DDL, PL/SQL
blocks, `CALL`, `EXEC`, `COMMIT`, `COMMENT ON`, `LOCK TABLE`, `PURGE`,
`FLASHBACK`, `ANALYZE` and `DBMS_STATS`. The guard strips comments, string
literals (including `q'[...]'`) and quoted identifiers before matching, and the
session is rolled back after every call so nothing can persist.

### Write mode

Set `ORACLE_READ_ONLY=false` on a server entry to let `execute_query` run DML,
DDL, PL/SQL blocks and procedure calls with autocommit. Even then the
server-level statements listed above stay blocked, and Oracle still enforces
the user's own privileges: the guard can only ever be stricter than the user,
never looser. Give write-enabled servers a distinct name in your client config
so using one is a deliberate choice.

The guard is defence in depth. Always connect with a least-privilege user as
well.

## How reconnection works

The driver pool is wrapped by a `PoolManager` that treats every pool as
disposable:

1. `connect()` failures are not cached; the next call creates a new pool.
2. Before reuse the pool must report `connected`; otherwise it is closed and
   replaced.
3. Concurrent first calls await a single in-flight connect.
4. Each query runs through `withRetry`: a connection-level error (`ORA-03113`,
   `ORA-03114`, `ORA-03135`, `ORA-12541`, `ORA-12170`, `ORA-00028` session
   killed, `NJS-500`/`NJS-510`/`NJS-511`) drops the dead connection, discards
   the pool and retries exactly once on a fresh one. SQL errors and
   `ORA-01017` (invalid login) are never retried.
5. `close()` force-closes the pool with a bounded wait, so a pool whose sockets
   are already dead never blocks the reconnect.

Details and the failure modes this covers: [docs/architecture.md](../../docs/architecture.md).

## Library use

The pieces are exported for embedding:

```ts
import {
  OracleExecutor,
  PoolManager,
  createOraclePool,
  createOracleServer,
  loadConfig,
} from '@qodalis/mcp-oracle';

const config = loadConfig(process.env);
const manager = new PoolManager({ createPool: createOraclePool(config) });
const executor = new OracleExecutor(manager, {
  maxRows: config.maxRows,
  readOnly: config.readOnly,
});
const server = createOracleServer({ config, executor, poolState: (db) => manager.describe(db) });
```

The driver ships no TypeScript types; the package declares the slice it uses.
Install `@types/oracledb` if you call the driver directly.

## Development

```bash
npm install
npm test                 # unit tests, no database required
npm run test:integration # live tests, needs RUN_INTEGRATION=1 and ORACLE_* set
npm run typecheck
npm run build
npx tsx scripts/check-reconnect.mts   # proves recovery from a network drop, no root needed
```

A disposable server for the live tests (first start takes a minute or two):

```bash
docker run -d --name mcp-sql-oracle -e ORACLE_PASSWORD=oracle -e APP_USER=mcp -e APP_USER_PASSWORD=mcp -p 1521:1521 gvenzl/oracle-free:23-slim-faststart
RUN_INTEGRATION=1 ORACLE_HOST=127.0.0.1 ORACLE_SERVICE=FREEPDB1 ORACLE_USER=mcp ORACLE_PASSWORD=mcp npm run test:integration
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

[MIT](LICENSE) © Qodalis Solutions SRL
