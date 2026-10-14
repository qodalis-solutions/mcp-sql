# Contributing

Thanks for helping improve `@qodalis/mcp-sqlserver`.

## Development setup

```bash
git clone https://github.com/qodalis-solutions/mcp-sqlserver.git
cd mcp-sqlserver
npm install
npm test            # unit tests (no database needed)
npm run typecheck
npm run build
```

Run the server against a real database during development:

```bash
cp .env.example .env   # edit credentials
npm run dev -- --env-file .env
```

## Tests

- Unit tests live in `tests/unit` and run without a database. They drive the
  pool manager and executor through small fakes in `tests/helpers`.
- The live suite in `tests/integration` needs a reachable SQL Server:

  ```bash
  RUN_INTEGRATION=1 SQLSERVER_HOST=... SQLSERVER_USER=... SQLSERVER_PASSWORD=... \
  SQLSERVER_DATABASE=... npm run test:integration
  ```

  It is read-only and skips itself when the variables are missing.

- Coverage thresholds are enforced by `npm run test:coverage`.

## Conventions

- TypeScript, ESM, 4-space indentation, single quotes, Prettier (`npm run format`).
- Write the test first. Every behaviour change ships with a test that fails
  without it.
- Object names from tool input are never interpolated into SQL; use
  `parseObjectName` / `qualifiedName` and named parameters.
- Nothing may be written to stdout at runtime: it is the MCP transport. Use
  the stderr logger.
- Properties and JSX-like attributes sorted alphabetically where practical.

## Releasing

1. Update `CHANGELOG.md` and bump `version` in `package.json`.
2. Open a pull request; CI runs format, typecheck, tests and build.
3. Merging to `main` publishes the new version to npm automatically (the
   workflow skips versions that already exist).
