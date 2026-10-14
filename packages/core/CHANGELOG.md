# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-14

### Changed

- No code change. Released in lockstep with `@qodalis/mcp-sqlserver` 0.2.1,
  which fixes a manifest that could not install.

## [0.2.0] - 2026-10-14

### Added

- First release, extracted from `@qodalis/mcp-sqlserver` 0.1.0: `PoolManager`
  with `withRetry`, the statement guard (`scrubSql`, `validateSql`) driven by a
  per-dialect `GuardProfile`, `createIdentifierTools`, `loadCommonConfig` with
  an `EnvSpec`, `.env` file loading, result formatting, the dialect-neutral
  `execute_query` and `test_connection` tools, `createServer`, `runCli`, and
  test fakes under `@qodalis/mcp-sql-core/testing`.
- `Dialect.likeEscape` selects backslash or bracket escaping for LIKE filters.
- `GuardProfile.isSessionLocal` receives the whole batch and the matched
  statement so a dialect can recognise tables declared temporary earlier in
  the batch.
