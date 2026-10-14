# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-14

### Added

- First release, built on `@qodalis/mcp-sql-core` and versioned in lockstep
  with the other `@qodalis/mcp-*` servers.
- Self-healing connection pool around `mysql2`: failed connects are never
  cached, disconnected pools are replaced on the next call, concurrent first
  calls share one connect, and queries retry once on connection loss
  (`PROTOCOL_CONNECTION_LOST`, `ECONNRESET`, `ER_SERVER_SHUTDOWN`, ...).
- Thirteen tools: `test_connection`, `get_server_info`, `list_databases`,
  `list_tables`, `list_views`, `list_procedures`, `describe_table`,
  `get_foreign_keys`, `get_table_stats`, `get_object_definition`,
  `search_objects`, `sample_data`, `execute_query`.
- Read-only guard that permits `TEMPORARY` tables, user variables, `SHOW` and
  `EXPLAIN` while blocking persistent writes; `LOAD DATA`, `INTO OUTFILE`,
  `LOAD_FILE`, users, grants, `SET GLOBAL`, plugins, replication, `KILL`,
  `SHUTDOWN` and `USE` are blocked in every mode.
- Streaming execution with a hard row cap (the connection is destroyed when
  the cap is hit so no further rows are read), `@name` parameters rewritten to
  `?`, multi-statement batches, abort support, and compact JSON / Markdown /
  CSV output.
- Database allowlist (`MYSQL_DATABASES`) with one pool per database.
- `MYSQL_*` configuration with `MARIADB_*` aliases, `MYSQL_URL` /
  `DATABASE_URL`, `.env` file support, and `MYSQL_SSL=false|require|verify`.
