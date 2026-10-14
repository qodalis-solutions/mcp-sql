# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
