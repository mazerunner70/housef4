#!/usr/bin/env bash
# Prove local API matches dev ergonomics: /api/health always public;
# /api/me returns 200 when DEV_AUTH_USER_ID is set (APP_ENV=local), else 401.
#
# Builds the backend, starts a short-lived server on PORT (default 3099), then curls.
#
# Usage:
#   ./scripts/test-local-auth-curl.sh
#
# Needs: curl, bash, pnpm (repo root)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3099}"
export PORT

cd "$ROOT/backend"
pnpm run build

run_server_expect() {
  local dev_id=$1
  local out="${TMPDIR:-/tmp}/housef4-local-$$.log"

  (
    cd "$ROOT/backend"
    export APP_ENV=local
    if [[ -n "$dev_id" ]]; then
      export DEV_AUTH_USER_ID="$dev_id"
    else
      unset DEV_AUTH_USER_ID || true
    fi
    node dist/adapters/localServer.js >"$out" 2>&1 &
    echo $!
  )
}

wait_http() {
  local n=0
  while ! curl -sS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; do
    n=$((n + 1))
    if [[ "$n" -gt 40 ]]; then
      echo "Timeout waiting for local server on $PORT" >&2
      return 1
    fi
    sleep 0.1
  done
}

echo "== Local auth smoke on http://127.0.0.1:${PORT}"
echo

pid="$(run_server_expect "")"
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' EXIT
wait_http

echo -n "1) GET /api/health (expect 200): "
curl -sS -o /tmp/housef4-l-health.json -w '%{http_code}' "http://127.0.0.1:${PORT}/api/health"
echo
cat /tmp/housef4-l-health.json
echo

echo -n "2) GET /api/me without DEV_AUTH_USER_ID (expect 401): "
code="$(curl -sS -o /tmp/housef4-l-me.json -w '%{http_code}' "http://127.0.0.1:${PORT}/api/me" || true)"
echo "$code"
if [[ "$code" != "401" ]]; then
  echo "FAILED: expected 401" >&2
  exit 1
fi

kill "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true
trap - EXIT

pid="$(run_server_expect "local-dev-subject-1")"
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' EXIT
wait_http

echo -n "3) GET /api/me with DEV_AUTH_USER_ID=local-dev-subject-1 (expect 200): "
code="$(curl -sS -o /tmp/housef4-l-me2.json -w '%{http_code}' "http://127.0.0.1:${PORT}/api/me" || true)"
echo "$code"
if [[ "$code" != "200" ]]; then
  echo "FAILED: expected 200" >&2
  cat /tmp/housef4-l-me2.json >&2 || true
  exit 1
fi
cat /tmp/housef4-l-me2.json
echo

echo
echo "OK: local bypass works; anonymous /api/me stays unauthorized."
