# Security

## Reporting a vulnerability

Email security@qodalis.com with a description and reproduction steps. Please do
not open a public issue for undisclosed vulnerabilities. We aim to acknowledge
reports within three working days.

## Design notes

- The server holds database credentials in memory only; they are read from the
  environment and are redacted from every error message it returns.
- Read-only mode is the default. It is enforced by a statement guard that
  scrubs comments and string literals before matching, so hidden keywords do
  not slip through. The guard is defence in depth, not a substitute for a
  least-privilege SQL login: always connect with a login that has only the
  rights the AI assistant should have.
- Server-level statements (`xp_cmdshell`, configuration, backups, logins,
  linked-server access) are blocked in every mode.
- Object names supplied by tools are parsed and bracket-quoted; values go
  through named parameters.
- Nothing is written to stdout except the MCP protocol stream.
