#!/usr/bin/env bash
# Full production rollout: prod build → terraform apply (Lambda zip, DynamoDB, etc.) → S3 + CloudFront.
#
# Usage (from repo root):
#   pnpm run build-deploy:prod
#   pnpm run build-deploy:prod -- -auto-approve # non-interactive apply
#   pnpm run build-deploy:prod -- -target=aws_lambda_function.api
#
# Needs: pnpm, terraform, aws (for apply + deploy script), configured state in infrastructure/

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${TF_DIR:-"$ROOT/infrastructure"}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

need terraform
need aws

bash "$ROOT/scripts/build-prod.sh"

# pnpm run … -- args passes a literal `--` before script flags; terraform apply
# treats `--` as "end of options", so `-auto-approve` would be read as a plan file.
if (( $# > 0 )) && [[ "$1" == "--" ]]; then
  shift
fi

echo "== terraform apply ($TF_DIR)"
echo "    (extra args forwarded: $*)"
terraform -chdir="$TF_DIR" apply "$@"

bash "$ROOT/scripts/deploy-frontend-aws.sh" --skip-build
