#!/usr/bin/env bash
# Build the Vite frontend, sync to the Terraform S3 bucket, and invalidate CloudFront.
#
# Usage:
#   ./scripts/deploy-frontend-aws.sh
#   ./scripts/deploy-frontend-aws.sh --skip-build    # reuse existing frontend/dist
#
# Needs: pnpm (unless --skip-build), terraform (always, for outputs), aws CLI, configured AWS creds.
# Env: TF_DIR (default repo/infrastructure), AWS_PROFILE as usual for aws/terraform.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${TF_DIR:-"$ROOT/infrastructure"}"
SKIP_BUILD=0
if [[ "${1:-}" == "--skip-build" ]]; then
  SKIP_BUILD=1
fi

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

need aws
need terraform

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  need pnpm
  echo "== Building frontend (VITE_COGNITO_* from Terraform outputs)"
  POOL="$(terraform -chdir="$TF_DIR" output -raw cognito_user_pool_id)"
  CLIENT="$(terraform -chdir="$TF_DIR" output -raw cognito_spa_client_id)"
  REGION="${AWS_REGION:-$(terraform -chdir="$TF_DIR" output -raw aws_region)}"
  (
    cd "$ROOT"
    export VITE_COGNITO_REGION="$REGION"
    export VITE_COGNITO_USER_POOL_ID="$POOL"
    export VITE_COGNITO_CLIENT_ID="$CLIENT"
    pnpm --filter frontend build
  )
else
  echo "== Skipping build (--skip-build)"
fi

if [[ ! -d "$ROOT/frontend/dist" ]] || [[ -z "$(ls -A "$ROOT/frontend/dist" 2>/dev/null)" ]]; then
  echo "frontend/dist is missing or empty; run without --skip-build first." >&2
  exit 1
fi

echo "== Resolving Terraform outputs ($TF_DIR)"
BUCKET="$(terraform -chdir="$TF_DIR" output -raw frontend_bucket_name)"
DIST="$(terraform -chdir="$TF_DIR" output -raw cloudfront_distribution_id)"

echo "== Sync to s3://$BUCKET/"
aws s3 sync "$ROOT/frontend/dist/" "s3://${BUCKET}/" --delete

echo "== CloudFront invalidation: $DIST (paths /*)"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --output json

echo
echo "OK: deploy finished. Site: https://$(terraform -chdir="$TF_DIR" output -raw cloudfront_domain_name)/"
