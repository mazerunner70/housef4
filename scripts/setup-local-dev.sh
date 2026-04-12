#!/usr/bin/env bash
# Start DynamoDB Local, seed the table + health row, build API packages, print browser URLs.
#
# Usage:
#   pnpm run build-deploy:local
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

echo "== Docker: DynamoDB Local"
docker compose up -d

echo
echo "== DynamoDB: table + health-check item (local build)"
bash scripts/ddb-local-bootstrap.sh

echo
echo "== Build @housef4/db + @housef4/backend"
pnpm --filter @housef4/db --filter @housef4/backend run build

VITE_PORT="${VITE_PORT:-5173}"
API_PORT="${PORT:-3000}"
TABLE="${DYNAMODB_TABLE_NAME:-housef4-local-table}"
DDB_URL="${DYNAMODB_ENDPOINT:-http://localhost:8000}"

echo
echo "==================================================================="
echo " Local stack is ready"
echo "==================================================================="
echo
echo "  Open in the browser (start the dev servers below first):"
echo
echo "    Health check page:  http://127.0.0.1:${VITE_PORT}/health-check"
echo "    (Vite proxies /api → backend on :${API_PORT})"
echo
echo "  Quick API check (with backend running):"
echo "    curl -s http://127.0.0.1:${API_PORT}/api/health | jq ."
echo
echo "  Run in two terminals from the repo root:"
echo
echo "    Terminal 1 — backend (use same user id as frontend .env.development):"
echo "      export DYNAMODB_TABLE_NAME=${TABLE} DYNAMODB_ENDPOINT=${DDB_URL} \\"
echo "        DEV_AUTH_USER_ID=local-dev APP_ENV=local PORT=${API_PORT}"
echo "      pnpm --filter @housef4/backend run start:local"
echo
echo "    Terminal 2 — frontend (VITE_LOCAL_USER_ID in frontend/.env.development):"
echo "      pnpm --filter frontend dev"
echo
echo "==================================================================="
