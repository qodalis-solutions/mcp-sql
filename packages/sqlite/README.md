# @qodalis/mcp-sqlite

A [Model Context Protocol](https://modelcontextprotocol.io) server for SQLite
files, built for AI assistants such as Claude Code, Claude Desktop, Cursor,
Windsurf and VS Code. It uses the Node.js built-in `node:sqlite` driver, so
there is nothing to compile and nothing to install beyond Node 22.13 or newer.

It is the quickest way to let an assistant look at a local development
database, an application's `.db` file, or the fixture files behind Playwright
and other end-to-end suites, with the same thirteen tools as the other
[Qodalis SQL MCP servers](https://github.com/qodalis-solutions/mcp-sql).

## Highlights

- **No native dependency.** `node:sqlite` ships with Node; `npx` starts the
  server in a second on any machine.
- **Read-only by default.** The file is opened read-only and a statement guard
  rejects persistent writes before they run, while still allowing `TEMP`
  tables, views and indexes so the assistant can stage intermediate results.
  `ATTACH`, `DETACH`, `load_extension`, `VACUUM INTO` and the
  `writable_schema` / `trusted_schema` pragmas are blocked in every mode.
- **Token-efficient results.** Columns are listed once, rows are arrays, a
  hard row cap flags truncation. Markdown and CSV on request.
- **Thirteen focused tools** for discovery (`search_objects`, `list_tables`,
  `describe_table`, `get_foreign_keys`, `get_object_definition`, ...) and
  querying (`execute_query` with named parameters, `sample_data`).
- **Several files per server** through an allowlist, each addressed by its
  basename; `:memory:` is accepted for scratch work.
- **Survives file replacement.** A file that is deleted, regenerated or
  restored from a backup underneath the running server is detected by inode
  and reopened on the next call, so regenerated fixtures never go stale.

## Quick start

```bash
npx -y @qodalis/mcp-sqlite --help
```

### Claude Code

```bash
claude mcp add app-db -e SQLITE_DATABASE=/path/to/app.db -- npx -y @qodalis/mcp-sqlite
```

or in `~/.claude.json`:

```json
{
  "mcpServers": {
    "app-db": {
      "command": "npx",
      "args": ["-y", "@qodalis/mcp-sqlite"],
      "env": {
        "SQLITE_DATABASE": "/path/to/app.db"
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
{ "command": "npx", "args": ["-y", "@qodalis/mcp-sqlite", "--env-file", "/path/to/.env"] }
```

Pin a version in shared configs (`@qodalis/mcp-sqlite@0.3.0`) so an upgrade is
a deliberate change.

## Configuration

Every setting is an environment variable.

| Variable                   | Default    | Description                                                                                                                                  |
| -------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `SQLITE_DATABASE`          | required\* | Path to the file, or `:memory:`. Relative paths resolve against the working directory.                                                       |
| `SQLITE_DATABASES`         | none       | Comma-separated allowlist of further files. Each file is addressed through the tools' `database` argument by its basename without extension. |
| `SQLITE_READ_ONLY`         | `true`     | Open the file read-only and reject persistent writes. See [read-only mode](#read-only-mode).                                                 |
| `SQLITE_CREATE_IF_MISSING` | `false`    | Create a missing file instead of failing. Only meaningful with `SQLITE_READ_ONLY=false`.                                                     |
| `SQLITE_MAX_ROWS`          | `1000`     | Hard cap on rows returned by any tool.                                                                                                       |
| `SQLITE_REQUEST_TIMEOUT`   | `30000`    | Busy timeout in milliseconds when another process holds a lock.                                                                              |
| `SQLITE_QUERY_LOG`         | `false`    | Log every statement to stderr.                                                                                                               |
| `SQLITE_ENV_FILE`          | none       | Path to a `.env` file (same as `--env-file`).                                                                                                |

\* `SQLITE_DATABASES` alone is enough; its first file becomes the default.

`/data/app.db` and `/data/archive.db` are addressed as `app` and `archive`.
Two files with the same basename are rejected at startup.

## Tools

| Tool                    | Purpose                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test_connection`       | Opens the file and runs a real query; reports the path, SQLite version, time and state. Never throws: returns `ok: false` with a hint instead.                     |
| `get_server_info`       | SQLite version, file path and size, page size, journal mode, encoding, user version.                                                                               |
| `list_databases`        | Schemas attached to the file (`main`, `temp`, ...) and the configured database keys.                                                                               |
| `list_tables`           | Tables with schema, kind (table, strict, without rowid, virtual), column count and row count; filter by schema or name.                                            |
| `list_views`            | Views; filter by schema or name.                                                                                                                                   |
| `list_procedures`       | Always empty: SQLite stores no procedures or functions. Kept so assistants can use the same tool set across databases.                                             |
| `describe_table`        | Columns with declared type, nullability, primary key position, default and generated flag; indexes with columns, unique and partial flags; foreign keys both ways. |
| `get_foreign_keys`      | Relationships for one table or the whole file, with columns and referential actions.                                                                               |
| `get_table_stats`       | Row count, size in KB (when SQLite was built with `dbstat`, otherwise `null`) and index count.                                                                     |
| `get_object_definition` | The stored `CREATE` statement of a table, view, index or trigger.                                                                                                  |
| `search_objects`        | Find tables, views, indexes, triggers and columns by name substring.                                                                                               |
| `sample_data`           | First or random rows from a table or view, optionally a column subset.                                                                                             |
| `execute_query`         | Run SQL with `@name` parameters; JSON, Markdown or CSV output.                                                                                                     |

Full argument reference: [docs/tools.md](../../docs/tools.md).

The `schema` argument of the catalog tools is the attached database name:
`main`, `temp`, or an alias created with `ATTACH` by the application that
owns the file. A multi-statement batch runs statement by statement and returns
the last result set; parameters are only accepted with a single statement.
Integers beyond 2^53 are returned as strings, blobs as `0x…` hex.

## Read-only mode

With `SQLITE_READ_ONLY=true` (the default) the file is opened read-only, so
SQLite itself refuses writes, and the statement guard rejects them before they
run. `execute_query` accepts:

- `SELECT`, `WITH ... SELECT`, `VALUES`, `EXPLAIN`, read `PRAGMA`s, and
  `BEGIN`/`COMMIT`/`ROLLBACK`;
- writes whose only targets are temporary objects: `CREATE TEMP TABLE`,
  `CREATE TEMP VIEW`, anything in the `temp` schema, and `INSERT`, `UPDATE`,
  `DELETE`, `DROP` and `CREATE INDEX` on a table declared temporary earlier
  in the same batch.

It rejects `INSERT`/`UPDATE`/`DELETE`/`REPLACE` on persistent tables, DDL,
`ALTER TABLE`, `VACUUM`, `REINDEX`, `ANALYZE` and `PRAGMA x = value`.

### Write mode

Set `SQLITE_READ_ONLY=false` to open the file read-write and let
`execute_query` run data and schema changes. `ATTACH`, `DETACH`,
`load_extension`, `VACUUM INTO` and the schema-tampering pragmas stay blocked.
Give write-enabled servers a distinct name in your client config so using one
is a deliberate choice.

## How file replacement is handled

Each configured file is opened once and kept open. Before every call the
server checks that the path still points at the inode it opened; when the
file was deleted, replaced or restored, the handle is closed and the file
reopened, so the assistant never keeps reading a stale copy. A missing file
fails with its path and is picked up again as soon as it reappears. `I/O`,
`not a database` and `cannot open` errors drop the handle in the same way.

## Library use

```ts
import {
  createSqliteDatabase,
  createSqliteServer,
  loadConfig,
  PoolManager,
  SqliteExecutor,
} from '@qodalis/mcp-sqlite';

const config = loadConfig(process.env);
const manager = new PoolManager({ createPool: createSqliteDatabase(config) });
const executor = new SqliteExecutor(manager, { maxRows: config.maxRows });
const server = createSqliteServer({ config, executor, poolState: (db) => manager.describe(db) });
```

## Development

```bash
npm install
npm test                 # unit tests against temporary files
npm run test:integration # end-to-end through the MCP client, no service needed
npm run typecheck
npm run build
npx tsx scripts/check-reopen.mts   # proves the built CLI reopens a replaced file
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

[MIT](LICENSE) © Qodalis Solutions SRL
