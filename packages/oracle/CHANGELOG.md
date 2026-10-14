# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-14

### Added

- First release, built on `@qodalis/mcp-sql-core` and versioned in lockstep
  with the other dialect packages. Uses `oracledb` in thin mode, so no Oracle
  Client libraries are required.
- Self-healing connection pool around `oracledb.createPool`: failed connects
  are never cached, disconnected pools are replaced, concurrent first calls
  share one connect, queries retry once on connection loss (`ORA-03113`,
  `ORA-03114`, `ORA-03135`, `ORA-12541`, `ORA-12170`, `ORA-00028`, `NJS-5xx`),
  and dead connections are dropped rather than returned to the pool.
- Thirteen tools: `test_connection`, `get_server_info`, `list_databases`
  (schemas), `list_tables`, `list_views`, `list_procedures`,
  `describe_table`, `get_foreign_keys`, `get_table_stats`,
  `get_object_definition`, `search_objects`, `sample_data`, `execute_query`.
- Read-only guard that permits private temporary tables (`ORA$PTT_*`) while
  blocking persistent writes, DDL, PL/SQL blocks and `COMMIT`; sessions are
  rolled back after every call. `UTL_*`, `DBMS_SCHEDULER`, users, roles,
  database links, directories, `ALTER SYSTEM` and `EXECUTE IMMEDIATE` are
  blocked in every mode.
- Server-side cursor execution with a hard row cap, `@name` parameters passed
  as native `:name` binds, sequential multi-statement batches on one session,
  LOBs inlined, abort support, and compact JSON / Markdown / CSV output.
- Schema allowlist (`ORACLE_DATABASES`); the `database` tool argument selects a
  schema since an Oracle session lives in one database.
- `ORACLE_*` configuration with `ORACLE_CONNECT_STRING` (EZConnect or TNS),
  `ORACLE_URL`, wallet settings for Autonomous Database, and `.env` support.
