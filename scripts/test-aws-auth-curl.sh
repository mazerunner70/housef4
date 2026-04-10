#!/usr/bin/env bash
# Prove API auth on AWS: static HTML is public; GET /api/health is public;
# other /api/* paths return 401 without a Bearer token (via CloudFront → API Gateway).
#
# Usage:
#   export CLOUDFRONT_BASE_URL="https://dxxxxxxxxxxxx.cloudfront.net"
#   ./scripts/test-aws-auth-curl.sh
#
# Or load outputs from Terraform (requires `terraform apply` and configured AWS creds):
#   ./scripts/test-aws-auth-curl.sh --from-terraform
#
# Needs: curl, bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${TF_DIR:-"$ROOT/infrastructure"}"

from_terraform() {
  command -v terraform >/dev/null || {
    echo "terraform not found" >&2
    return 1
  }
  local domain
  domain="$(terraform -chdir="$TF_DIR" output -raw cloudfront_domain_name)"
  echo "https://${domain}"
}

if [[ "${1:-}" == "--from-terraform" ]]; then
  BASE_URL="$(from_terraform)"
  shift || true
else
  BASE_URL="${CLOUDFRONT_BASE_URL:?Set CLOUDFRONT_BASE_URL (https://...) or pass --from-terraform}"
fi

# Trim trailing slash
BASE_URL="${BASE_URL%/}"

echo "== AWS auth smoke against: $BASE_URL"
echo

echo -n "1) Static SPA root (expect 200, public): "
code="$(curl -sS -o /tmp/housef4-static.html -w '%{http_code}' "$BASE_URL/" || true)"
echo "$code"
if [[ "$code" != "200" ]]; then
  echo "   FAILED: expected 200" >&2
  exit 1
fi
if ! head -c 200 /tmp/housef4-static.html | grep -qiE 'html|<!doctype'; then
  echo "   WARN: response does not look like HTML (s3/cloudfront misconfig?)" >&2
fi

echo -n "2) GET /api/health (expect 200, public): "
code="$(curl -sS -o /tmp/housef4-health.json -w '%{http_code}' "$BASE_URL/api/health" || true)"
echo "$code"
if [[ "$code" != "200" ]]; then
  echo "   FAILED: expected 200" >&2
  exit 1
fi
cat /tmp/housef4-health.json
echo

echo -n "3) GET /api/me without Authorization (expect 401): "
code="$(curl -sS -o /tmp/housef4-me.json -w '%{http_code}' "$BASE_URL/api/me" || true)"
echo "$code"
if [[ "$code" != "401" ]]; then
  echo "   FAILED: expected 401 Unauthorized (body below)" >&2
  cat /tmp/housef4-me.json >&2 || true
  exit 1
fi
cat /tmp/housef4-me.json
echo

echo
echo "OK: static + health reachable without login; /api/me rejects anonymous calls."
