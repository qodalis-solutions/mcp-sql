# @qodalis/mcp-sql-core

Shared building blocks for the Qodalis resilient SQL MCP servers. You only need
this package directly when writing a server for another database engine;
assistants should install [`@qodalis/mcp-sqlserver`](https://www.npmjs.com/package/@qodalis/mcp-sqlserver)
or [`@qodalis/mcp-postgres`](https://www.npmjs.com/package/@qodalis/mcp-postgres).

What it provides:

- `PoolManager`: the self-healing pool wrapper (never caches a failed connect,
  replaces disconnected pools, discards on pool errors, dedupes concurrent
  connects, retries once on connection loss through `withRetry`).
- `scrubSql` / `validateSql`: a statement guard driven by a per-dialect
  `GuardProfile` (always-blocked rules, read-only rules, targeted writes with a
  session-local predicate, comment and quoting style).
- `createIdentifierTools`: safe parsing and quoting of object names for a
  quoting style.
- `loadCommonConfig` / `createEnvReader`: environment parsing with aliases,
  validation and shared defaults.
- `formatResult`: compact JSON, Markdown and CSV rendering.
- `executeQueryTool`, `testConnectionTool`, `runTool`, `createServer`,
  `runCli`: the generic tools, the MCP wiring and the shared `main()`.
- `@qodalis/mcp-sql-core/testing`: fakes for writing dialect tests.

A dialect package supplies a `Dialect` (name, guard profile, identifier style,
probe query), an `IQueryExecutor` over its driver, its catalog tools and a
five-line `bin` that calls `runCli`. See `packages/sqlserver` and
`packages/postgres` in the [repository](https://github.com/qodalis-solutions/mcp-sql)
for two complete examples.

MIT © Qodalis Solutions SRL
