# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-14

### Added

- First release, built on `@qodalis/mcp-sql-core` and versioned in lockstep
  with the other dialect packages.
- SQLite through the Node.js built-in `node:sqlite` driver: no native
  dependency, no install step; Node 22.13 or newer.
- The same thirteen tools as the other servers: `test_connection`,
  `get_server_info`, `list_databases`, `list_tables`, `list_views`,
  `list_procedures` (always empty, SQLite has none), `describe_table`,
  `get_foreign_keys`, `get_table_stats`, `get_object_definition`,
  `search_objects`, `sample_data`, `execute_query`.
- Read-only mode opens the file read-only and the statement guard rejects
  persistent writes while still allowing `TEMP` tables, views and indexes;
  `ATTACH`, `DETACH`, `load_extension`, `VACUUM INTO` and the
  `writable_schema` / `trusted_schema` pragmas are blocked in every mode.
- Several files per server through `SQLITE_DATABASES`, each addressed by its
  basename; `:memory:` is accepted.
- A file that is deleted, replaced or restored underneath the running server
  is detected by inode and reopened on the next call.
- Big integers are read as bigint and returned as numbers when safe, as
  strings otherwise; blobs are returned as hex.
