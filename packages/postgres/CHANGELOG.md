# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-10-14

### Added

- First release, built on `@qodalis/mcp-sql-core` and versioned in lockstep
  with `@qodalis/mcp-sqlserver`.
- Self-healing connection pool around `pg.Pool`: failed connects are never
  cached, disconnected pools are replaced on the next call, pool `error`
  events discard the pool, concurrent first calls share one connect, and
  queries retry once on connection loss (including `57P01` admin shutdown).
- Thirteen tools: `test_connection`, `get_server_info`, `list_databases`,
  `list_tables`, `list_views`, `list_procedures`, `describe_table`,
  `get_foreign_keys`, `get_table_stats`, `get_object_definition`,
  `search_objects`, `sample_data`, `execute_query`.
- Read-only guard that permits `TEMP` tables and `pg_temp` while blocking
  persistent writes; `COPY ... PROGRAM`, file access functions, roles,
  databases, extensions and `ALTER SYSTEM` are blocked in every mode.
- Streaming execution through a server-side cursor with a hard row cap, `@name`
  parameters rewritten to `$n`, multi-statement batches through the simple
  protocol, `RAISE NOTICE` capture, abort support, and compact JSON / Markdown /
  CSV output.
- Database allowlist (`POSTGRES_DATABASES`) with one pool per database.
- `POSTGRES_*` configuration with libpq `PG*` fallbacks, `POSTGRES_URL` /
  `DATABASE_URL`, `.env` file support, and `POSTGRES_SSL=false|require|verify`.
