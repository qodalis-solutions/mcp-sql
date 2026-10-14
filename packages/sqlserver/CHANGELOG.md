# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-14

### Fixed

- 0.2.0 could not be installed from npm: the manifest did not declare the
  dependency on `@qodalis/mcp-sql-core` (the workspace symlink hid it). Do not
  use 0.2.0.

## [0.2.0] - 2026-10-14

### Changed

- Moved into the `qodalis-solutions/mcp-sql` monorepo. The pool manager,
  statement guard, result formatting, CLI and server wiring now live in
  `@qodalis/mcp-sql-core`, which this package re-exports, so embedders keep a
  single import. Behaviour and configuration are unchanged.

### Fixed

- `list_tables`, `list_views`, `list_procedures` and `search_objects` escape
  `%`, `_` and `[` in the name filter with SQL Server bracket escaping.

## [0.1.0] - 2026-10-14

### Added

- Self-healing connection pool: failed connects are never cached, disconnected
  pools are replaced on the next call, pool `error` events discard the pool,
  concurrent first calls share one connect, and queries retry once on
  connection loss. Recovers from VPN and network interruptions without a
  restart.
- Thirteen tools: `test_connection`, `get_server_info`, `list_databases`,
  `list_tables`, `list_views`, `list_procedures`, `describe_table`,
  `get_foreign_keys`, `get_table_stats`, `get_object_definition`,
  `search_objects`, `sample_data`, `execute_query`.
- Read-only guard that permits `#temp` tables and `@table` variables while
  blocking persistent writes; server-level statements are blocked in every mode.
- Streaming execution with a hard row cap, named parameters, abort support,
  and compact JSON / Markdown / CSV output.
- Database allowlist (`SQLSERVER_DATABASES`) with one pool per database.
- `SQLSERVER_*` configuration with `MSSQL_*` fallbacks, `.env` file support,
  NTLM authentication.
