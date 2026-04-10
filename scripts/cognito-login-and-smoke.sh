#!/usr/bin/env bash
# Log in with Cognito (server-side admin password flow) then verify:
# - CloudFront serves static HTML (public)
# - GET /api/health (public)
# - GET /api/me with IdToken (protected; use ID token for API Gateway JWT audience)
#
# Prerequisites:
# - Terraform applied with cognito_allow_admin_password_auth = true (default)
# - Test user: run ./scripts/cognito-bootstrap-test-user.sh once
# - Tools: aws, curl, jq
#
# Usage:
#   export AWS_REGION=eu-west-2
#   export COGNITO_TEST_EMAIL="test@example.com"
#   export COGNITO_TEST_PASSWORD='...'
#   pnpm run test:auth:cognito-smoke          # loads pool/client/CloudFront from Terraform
#   ./scripts/cognito-login-and-smoke.sh --from-terraform
#
#   If you call the script yourself without --from-terraform, set COGNITO_USER_POOL_ID,
#   COGNITO_CLIENT_ID, and CLOUDFRONT_BASE_URL — or pass --from-terraform.
#   (Plain `pnpm run <script> --flag` does NOT pass flag to bash; use `pnpm run ... -- --from-terraform`
#   only for scripts that do not already add that flag.)
#
# Or set explicitly:
#   export COGNITO_USER_POOL_ID=...
#   export COGNITO_CLIENT_ID=...
#   export CLOUDFRONT_BASE_URL=https://dxxx.cloudfront.net
#   ./scripts/cognito-login-and-smoke.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${TF_DIR:-"$ROOT/infrastructure"}"

load_outputs_from_terraform() {
  command -v terraform >/dev/null || {
    echo "terraform not found (install it or set COGNITO_* and CLOUDFRONT_BASE_URL)" >&2
    return 1
  }
  export COGNITO_USER_POOL_ID="$(terraform -chdir="$TF_DIR" output -raw cognito_user_pool_id)"
  export COGNITO_CLIENT_ID="$(terraform -chdir="$TF_DIR" output -raw cognito_spa_client_id)"
  local domain
  domain="$(terraform -chdir="$TF_DIR" output -raw cloudfront_domain_name)"
  export CLOUDFRONT_BASE_URL="https://${domain}"
}

# Same values as load_outputs_from_terraform, but never exits the script (for optional auto-fill).
try_load_outputs_from_terraform() {
  command -v terraform >/dev/null || return 1
  local pool client domain
  set +e
  pool="$(terraform -chdir="$TF_DIR" output -raw cognito_user_pool_id 2>/dev/null)"
  client="$(terraform -chdir="$TF_DIR" output -raw cognito_spa_client_id 2>/dev/null)"
  domain="$(terraform -chdir="$TF_DIR" output -raw cloudfront_domain_name 2>/dev/null)"
  set -e
  if [[ -n "$pool" && -n "$client" && -n "$domain" ]]; then
    export COGNITO_USER_POOL_ID="$pool"
    export COGNITO_CLIENT_ID="$client"
    export CLOUDFRONT_BASE_URL="https://${domain}"
    return 0
  fi
  return 1
}

if [[ "${1:-}" == "--from-terraform" ]]; then
  shift || true
  load_outputs_from_terraform
fi

# If vars still unset (e.g. `pnpm` did not pass args to bash), fill from Terraform when possible.
if [[ -z "${COGNITO_CLIENT_ID:-}" || -z "${COGNITO_USER_POOL_ID:-}" || -z "${CLOUDFRONT_BASE_URL:-}" ]]; then
  try_load_outputs_from_terraform || true
fi

POOL="${COGNITO_USER_POOL_ID:?Set pool id or pass --from-terraform / run from repo with terraform outputs}"
CLIENT="${COGNITO_CLIENT_ID:?Set client id or pass --from-terraform / run from repo with terraform outputs}"
BASE_URL="${CLOUDFRONT_BASE_URL:?Set CLOUDFRONT_BASE_URL or pass --from-terraform}"
EMAIL="${COGNITO_TEST_EMAIL:?}"
PASS="${COGNITO_TEST_PASSWORD:?}"

BASE_URL="${BASE_URL%/}"

command -v jq >/dev/null || {
  echo "jq is required" >&2
  exit 1
}

echo "== Cognito login + CloudFront/API smoke"
echo "   Base: $BASE_URL"
echo

echo "1) AdminInitiateAuth (ID token for Bearer)..."
auth_json="$(
  aws cognito-idp admin-initiate-auth \
    --user-pool-id "$POOL" \
    --client-id "$CLIENT" \
    --auth-flow ADMIN_USER_PASSWORD_AUTH \
    --auth-parameters "USERNAME=$EMAIL,PASSWORD=$PASS" \
    --output json
)"

id_token="$(echo "$auth_json" | jq -r '.AuthenticationResult.IdToken // empty')"
if [[ -z "$id_token" || "$id_token" == "null" ]]; then
  echo "Login failed (no IdToken). Response:" >&2
  echo "$auth_json" | jq . >&2
  echo >&2
  echo "Check: user exists (cognito-bootstrap-test-user.sh), password, and Terraform cognito_allow_admin_password_auth." >&2
  exit 1
fi

echo -n "2) Static index (expect 200): "
code="$(curl -sS -o /tmp/housef4-full-static.html -w '%{http_code}' "$BASE_URL/" || true)"
echo "$code"
[[ "$code" == "200" ]]

echo -n "3) GET /api/health (expect 200): "
code="$(curl -sS -o /tmp/housef4-full-health.json -w '%{http_code}' "$BASE_URL/api/health" || true)"
echo "$code"
[[ "$code" == "200" ]]

echo -n "4) GET /api/me with Bearer IdToken (expect 200): "
code="$(
  curl -sS -o /tmp/housef4-full-me.json -w '%{http_code}' \
    -H "Authorization: Bearer $id_token" \
    "$BASE_URL/api/me" || true
)"
echo "$code"
if [[ "$code" != "200" ]]; then
  echo "Body:" >&2
  cat /tmp/housef4-full-me.json >&2 || true
  exit 1
fi

echo "Response:"
cat /tmp/housef4-full-me.json | jq .
sub="$(jq -r '.userId' </tmp/housef4-full-me.json)"
if [[ -z "$sub" || "$sub" == "null" ]]; then
  echo "Missing userId in JSON" >&2
  exit 1
fi

echo
echo "OK: logged in; static + health public; /api/me returned userId for authenticated request."
