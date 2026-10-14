# Contributing

Thanks for helping improve the Qodalis SQL MCP servers.

## Repository layout

```
packages/core        @qodalis/mcp-sql-core   shared runtime: pool manager, guard, tools, CLI, server
packages/sqlserver   @qodalis/mcp-sqlserver  SQL Server dialect (mssql driver)
packages/postgres    @qodalis/mcp-postgres   PostgreSQL dialect (pg driver)
packages/mysql       @qodalis/mcp-mysql      MySQL / MariaDB dialect (mysql2 driver)
packages/oracle      @qodalis/mcp-oracle     Oracle dialect (oracledb thin mode)
packages/sqlite      @qodalis/mcp-sqlite     SQLite dialect (node:sqlite, Node 22.13+)
docs/                architecture and tool reference shared by every dialect
```

The packages are npm workspaces and are versioned in lockstep. A dialect
package depends on the published core, so after changing core run
`npm run build -w packages/core` before type-checking a dialect.

## Development setup

```bash
git clone https://github.com/qodalis-solutions/mcp-sql.git
cd mcp-sql
npm install
npm run build       # core first, then the dialects
npm test            # unit tests for every package (no database needed)
npm run typecheck
```

Run a server against a real database during development:

```bash
cd packages/sqlserver          # or postgres, mysql, oracle, sqlite
cp .env.example .env           # edit credentials
npm run dev -- --env-file .env
```

## Tests

- Unit tests live in each package's `tests/unit` and run without a database.
  They drive the pool manager and executor through small fakes
  (`packages/core/src/testing` and each package's `tests/helpers`).
  `npx vitest run --project <core|sqlserver|postgres|mysql|oracle|sqlite>` runs one package.
- The live suites in `packages/*/tests/integration` need a reachable server
  and skip themselves when the variables are missing:

  ```bash
  RUN_INTEGRATION=1 SQLSERVER_HOST=... SQLSERVER_USER=... SQLSERVER_PASSWORD=... \
  SQLSERVER_DATABASE=... npx vitest run --project sqlserver-integration

  docker run -d --name mcp-sql-postgres -e POSTGRES_USER=mcp -e POSTGRES_PASSWORD=mcp \
    -e POSTGRES_DB=mcp -p 5432:5432 postgres:17-alpine
  RUN_INTEGRATION=1 POSTGRES_HOST=localhost POSTGRES_USER=mcp POSTGRES_PASSWORD=mcp \
  POSTGRES_DATABASE=mcp POSTGRES_SSL=false npx vitest run --project postgres-integration

  docker run -d --name mcp-sql-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_USER=mcp \
    -e MYSQL_PASSWORD=mcp -e MYSQL_DATABASE=mcp -p 3306:3306 mysql:8.4
  RUN_INTEGRATION=1 MYSQL_HOST=127.0.0.1 MYSQL_USER=mcp MYSQL_PASSWORD=mcp \
  MYSQL_DATABASE=mcp MYSQL_SSL=false npx vitest run --project mysql-integration

  docker run -d --name mcp-sql-oracle -e ORACLE_PASSWORD=oracle -e APP_USER=mcp \
    -e APP_USER_PASSWORD=mcp -p 1521:1521 gvenzl/oracle-free:23-slim-faststart
  RUN_INTEGRATION=1 ORACLE_HOST=127.0.0.1 ORACLE_SERVICE=FREEPDB1 ORACLE_USER=mcp \
  ORACLE_PASSWORD=mcp ORACLE_ADMIN_PASSWORD=oracle npx vitest run --project oracle-integration

  npx vitest run --project sqlite-integration   # needs no service
  ```

  The SQL Server suite is read-only. The PostgreSQL, MySQL and Oracle suites
  create and drop their own objects, so point them at disposable databases;
  CI runs them against `postgres:17`, `mysql:8.4` and
  `gvenzl/oracle-free:23` services on every push. The SQLite suite uses a
  temporary file.

- `packages/*/scripts/check-reconnect.mts` starts the built server over stdio
  behind a local TCP proxy, kills and restores the proxy, and checks that the
  same process answers again. Run it after `npm run build` with the package's
  `*_HOST` variables set. It is the closest thing to a VPN drop that needs no
  root.

- Coverage thresholds are enforced by `npm run test:coverage`.
- `scripts/check-packed.sh` packs every package and installs the tarballs
  outside the workspace, then runs the CLIs. Run it before a release: inside
  the workspace a missing dependency still resolves through the symlinked
  `node_modules`, so only this proves the published artefacts install.

## Adding a dialect

1. Create `packages/<name>` with `config.ts` (an `EnvSpec` for
   `loadCommonConfig`), `dialect.ts` (a `Dialect`: guard profile, identifier
   style, LIKE escaping, probe SQL), `sql/executor.ts` (an `IQueryExecutor`
   that streams with a row cap and honours the abort signal), a pool adapter
   that implements `PoolLike`, and the catalog tools under `tools/`.
2. Reuse `executeQueryTool` and `testConnectionTool` from core; they are
   dialect-neutral.
3. Add `vitest.config.ts` and `vitest.integration.config.ts` with flat project
   names (`<name>`, `<name>-integration`), and list the package in
   `.github/workflows/publish.yml` after core.

## Conventions

- TypeScript, ESM, 4-space indentation, single quotes, Prettier (`npm run format`).
- Write the test first. Every behaviour change ships with a test that fails
  without it.
- Object names from tool input are never interpolated into SQL; use
  `parseObjectName` / `qualifiedName` and named parameters.
- Nothing may be written to stdout at runtime: it is the MCP transport. Use
  the stderr logger.
- Properties sorted alphabetically where practical.

## Releasing

1. Update the package `CHANGELOG.md` files and bump `version` in every
   `package.json` (the packages move together) and the core dependency range
   in the dialect packages.
2. Open a pull request; CI runs format, typecheck, tests, the PostgreSQL live
   suite and build.
3. Merging to `main` publishes every version that is not on npm yet, core
   first (the workflow skips versions that already exist). Authentication
   uses the organisation's `NPM_TOKEN` secret, or npm trusted publishing
   (OIDC) when the secret is absent.
