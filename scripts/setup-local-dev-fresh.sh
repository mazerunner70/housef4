#!/usr/bin/env bash
# Like setup-local-dev.sh, but tears down DynamoDB Local first so its in-memory
# database is empty (new container on next up).
#
# Usage:
#   pnpm run build-deploy:local:fresh
#
# Needs: docker, docker compose, aws CLI, pnpm

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

need docker
need pnpm

echo "== Docker: stop and remove containers (DynamoDB Local is -inMemory → data cleared)"
docker compose down --remove-orphans

echo
exec bash scripts/setup-local-dev.sh
