#!/usr/bin/env bash
# Set a new permanent password for an existing Cognito user (email = username).
# Requires IAM permission cognito-idp:AdminSetUserPassword on the user pool.
#
# Usage:
#   export AWS_REGION=eu-west-2
#   export COGNITO_USER_POOL_ID="eu-west-2_xxxx"
#   export COGNITO_TEST_EMAIL="you@example.com"
#   export COGNITO_TEST_PASSWORD='NewPass1Aa'
#   ./scripts/cognito-reset-user-password.sh
#
# Or load pool id from Terraform:
#   export COGNITO_TEST_EMAIL="you@example.com"
#   export COGNITO_TEST_PASSWORD='NewPass1Aa'
#   ./scripts/cognito-reset-user-password.sh --from-terraform
#
# Password must satisfy the pool policy (see infrastructure/cognito.tf).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${TF_DIR:-"$ROOT/infrastructure"}"

if [[ "${1:-}" == "--from-terraform" ]]; then
  shift || true
  command -v terraform >/dev/null || {
    echo "terraform not found" >&2
    exit 1
  }
  export COGNITO_USER_POOL_ID="$(terraform -chdir="$TF_DIR" output -raw cognito_user_pool_id)"
fi

POOL="${COGNITO_USER_POOL_ID:?Set COGNITO_USER_POOL_ID or pass --from-terraform}"
EMAIL="${COGNITO_TEST_EMAIL:?Set COGNITO_TEST_EMAIL}"
PASS="${COGNITO_TEST_PASSWORD:?Set COGNITO_TEST_PASSWORD}"

aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL" \
  --username "$EMAIL" \
  --password "$PASS" \
  --permanent

echo "OK: password updated for $EMAIL — sign in with the new password."
