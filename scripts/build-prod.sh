#!/usr/bin/env bash
# Production build: @housef4/db + @housef4/backend (dist + dist-lambda) + Vite frontend with Cognito env from Terraform.
#
# Usage:
#   pnpm run build:prod
#
# Needs: pnpm, terraform (for outputs), configured state in infrastructure/

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${TF_DIR:-"$ROOT/infrastructure"}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

need pnpm
need terraform

echo "== @housef4/db + @housef4/backend (tsc + Lambda bundle)"
(
  cd "$ROOT"
  pnpm --filter @housef4/db --filter @housef4/backend run build
)

echo "== frontend (VITE_* from Terraform outputs)"
POOL="$(terraform -chdir="$TF_DIR" output -raw cognito_user_pool_id)"
CLIENT="$(terraform -chdir="$TF_DIR" output -raw cognito_spa_client_id)"
REGION="${AWS_REGION:-$(terraform -chdir="$TF_DIR" output -raw aws_region)}"
(
  cd "$ROOT"
  export VITE_AUTH_UI=cognito
  export VITE_COGNITO_REGION="$REGION"
  export VITE_COGNITO_USER_POOL_ID="$POOL"
  export VITE_COGNITO_CLIENT_ID="$CLIENT"
  pnpm --filter frontend build
)

echo
echo "OK: prod build complete (backend/dist-lambda + frontend/dist)."
echo "    To apply infra + upload SPA: pnpm run build-deploy:prod [-- -auto-approve]"
