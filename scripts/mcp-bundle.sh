#!/usr/bin/env bash
# Builds the VPS's bundle: mcp/dist/viadukt-mcp-<commit>.tar.gz with viadukt-mcp-docker/src/, its
# SHA-256 and what to check (mcp/README.md). From a clean tree: REVISION must say what is in it.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain -- . ':!mcp/dist')" ] && [ "${ALLOW_DIRTY:-}" != 1 ]; then
  echo "The tree has uncommitted changes: commit first (or ALLOW_DIRTY=1 for a test)." >&2
  exit 1
fi
commit=$(git rev-parse --short HEAD)
[ -z "$(git status --porcelain -- . ':!mcp/dist')" ] || commit="$commit-dirty"
out=mcp/dist
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
src="$work/viadukt-mcp-docker/src"
mkdir -p "$src" "$out"
npx esbuild mcp/src/main.ts --bundle --platform=node --format=esm --target=node22 \
  --packages=external --log-level=warning --outfile="$src/server.mjs"
cp mcp/Dockerfile mcp/package.json mcp/package-lock.json public/data/stops.v1.json "$src/"
echo "$commit" > "$src/REVISION"
tarball="viadukt-mcp-$commit.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$out/$tarball" -C "$work" viadukt-mcp-docker
(cd "$out" && shasum -a 256 "$tarball" > "$tarball.sha256")
cat "$out/$tarball.sha256"
