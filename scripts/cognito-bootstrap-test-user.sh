#!/usr/bin/env bash
# One-time: create a Cognito user with a permanent password (for smoke tests).
# Pool uses email as username.
#
# Usage:
#   export AWS_REGION=eu-west-2
#   export COGNITO_USER_POOL_ID="eu-west-2_xxxx"
#   export COGNITO_TEST_EMAIL="test@example.com"
#   export COGNITO_TEST_PASSWORD='YourTempPass1'
#   ./scripts/cognito-bootstrap-test-user.sh
#
# Needs: aws CLI v2

set -euo pipefail

POOL="${COGNITO_USER_POOL_ID:?}"
EMAIL="${COGNITO_TEST_EMAIL:?}"
PASS="${COGNITO_TEST_PASSWORD:?}"

echo "Creating user $EMAIL in pool $POOL (if already exists, this may error — that is OK)"
set +e
aws cognito-idp admin-create-user \
  --user-pool-id "$POOL" \
  --username "$EMAIL" \
  --user-attributes "Name=email,Value=$EMAIL" "Name=email_verified,Value=true" \
  --message-action SUPPRESS
create_status=$?
set -e

if [[ "$create_status" -ne 0 ]]; then
  echo "(admin-create-user failed — user may already exist; continuing to set password)"
fi

aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL" \
  --username "$EMAIL" \
  --password "$PASS" \
  --permanent

echo "OK: user ready for admin-initiate-auth / smoke tests."
