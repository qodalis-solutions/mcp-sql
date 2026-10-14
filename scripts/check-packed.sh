#!/usr/bin/env bash
# Packs every workspace package and installs the tarballs in a directory
# outside the workspace, then runs each CLI. Inside the workspace a missing
# dependency still resolves through the symlinked node_modules; this is the
# only check that proves the published artefacts can actually install.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cd "$root"
npm pack --workspaces --pack-destination "$tmp" >/dev/null

cd "$tmp"
npm init -y >/dev/null
npm install --no-audit --no-fund --loglevel=error ./*.tgz >/dev/null

for cli in mcp-sqlserver mcp-postgres mcp-mysql mcp-oracle mcp-sqlite; do
    version="$(./node_modules/.bin/$cli --version)"
    echo "$cli: $version"
done
echo "packed install OK"
