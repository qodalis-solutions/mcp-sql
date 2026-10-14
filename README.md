# Qodalis SQL MCP servers

Resilient [Model Context Protocol](https://modelcontextprotocol.io) servers for
relational databases, built for AI assistants such as Claude Code, Claude
Desktop, Cursor, Windsurf and VS Code.

They exist because most database MCP servers stop working after a network blip:
once the VPN drops they cache a dead connection pool and every later call fails
until the assistant is restarted. These servers heal themselves instead.

| Package                                        | Database                                                                                           | Install                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- |
| [`@qodalis/mcp-sqlserver`](packages/sqlserver) | Microsoft SQL Server, Azure SQL, RDS for SQL Server, Fabric SQL                                    | `npx -y @qodalis/mcp-sqlserver` |
| [`@qodalis/mcp-postgres`](packages/postgres)   | PostgreSQL 12+, Aurora/RDS PostgreSQL, Neon, Supabase, CockroachDB, Timescale                      | `npx -y @qodalis/mcp-postgres`  |
| [`@qodalis/mcp-mysql`](packages/mysql)         | MySQL 8.0+, MariaDB 10.5+, Aurora/RDS MySQL, Azure Database for MySQL, Cloud SQL, PlanetScale      | `npx -y @qodalis/mcp-mysql`     |
| [`@qodalis/mcp-oracle`](packages/oracle)       | Oracle Database 12.2+, 19c, 21c, 23ai/Free, Autonomous Database (thin driver, no client libraries) | `npx -y @qodalis/mcp-oracle`    |
| [`@qodalis/mcp-sqlite`](packages/sqlite)       | SQLite files through the Node.js built-in driver (Node 22.13+), no native dependency               | `npx -y @qodalis/mcp-sqlite`    |
| [`@qodalis/mcp-sql-core`](packages/core)       | Shared core for building further dialects                                                          | library only                    |

Every server shares the same behaviour:

- **Self-healing connections.** A failed connect is never cached, a disconnected
  pool is replaced on the next call, pool errors discard the pool, concurrent
  first calls share one connect, and queries retry once on connection loss.
- **Read-only by default** with a statement guard that still allows session-local
  temporary objects, and server-level statements blocked in every mode.
- **Token-efficient results**: columns listed once, rows as arrays, streaming
  with a hard row cap, truncation flagged, Markdown and CSV on request.
- **The same thirteen tools** for discovery and querying, so switching between
  databases changes nothing for the assistant.
- **A database allowlist** with one pool per database, fast failure when the
  host is unreachable, and error messages that say what to do next.

See each package's README for configuration and the tool reference,
[docs/tools.md](docs/tools.md) for the per-dialect notes, and
[docs/architecture.md](docs/architecture.md) for how reconnection works.

## Development

```bash
npm install
npm run build        # core first, then the dialects
npm run typecheck
npm test             # unit tests for every package, no database needed
```

Live tests need a database: `RUN_INTEGRATION=1` plus the package's `*_HOST`
variables, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Qodalis Solutions SRL
