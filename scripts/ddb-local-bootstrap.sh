#!/usr/bin/env bash
# Create the app single-table on DynamoDB Local if it does not exist (schema aligned with infrastructure/main.tf).
set -euo pipefail

ENDPOINT="${DYNAMODB_ENDPOINT:-http://localhost:8000}"
TABLE="${DYNAMODB_TABLE_NAME:-housef4-local-table}"
REGION="${AWS_REGION:-eu-west-2}"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-local}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-local}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required (e.g. apt install awscli / brew install awscli)." >&2
  exit 1
fi

MAX_ATTEMPTS="${DDB_BOOTSTRAP_MAX_ATTEMPTS:-60}"
SLEEP_SEC="${DDB_BOOTSTRAP_SLEEP_SEC:-1}"

# True when stderr/out looks like the endpoint is not up yet (retry).
is_connection_like_error() {
  grep -qiE \
    'Could not connect to the endpoint URL|Connection refused|Connection reset|timed out|Time out|Name or service not known|Could not resolve host|nodename nor servname|ECONNREFUSED|Unable to connect|Max retries exceeded|Read timeout|Connect timeout|Failed to connect|Connection closed|Temporary failure in name resolution' \
    <<<"$1"
}

retry=0
resolved=0

while (( retry < MAX_ATTEMPTS )); do
  set +e
  describe_out=$(
    aws dynamodb describe-table \
      --table-name "$TABLE" \
      --endpoint-url "$ENDPOINT" \
      --region "$REGION" 2>&1
  )
  describe_code=$?
  set -euo pipefail

  if (( describe_code == 0 )); then
    echo "Table $TABLE already exists at $ENDPOINT"
    resolved=1
    break
  fi

  if grep -q 'ResourceNotFoundException' <<<"$describe_out"; then
    echo "Creating table $TABLE at $ENDPOINT ..."
    aws dynamodb create-table \
      --endpoint-url "$ENDPOINT" \
      --region "$REGION" \
      --table-name "$TABLE" \
      --billing-mode PAY_PER_REQUEST \
      --attribute-definitions \
        AttributeName=PK,AttributeType=S \
        AttributeName=SK,AttributeType=S \
        AttributeName=GSI1PK,AttributeType=S \
        AttributeName=GSI1SK,AttributeType=S \
        AttributeName=GSI2PK,AttributeType=S \
        AttributeName=GSI2SK,AttributeType=S \
      --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
      --global-secondary-indexes \
        "[{\"IndexName\":\"GSI1\",\"KeySchema\":[{\"AttributeName\":\"GSI1PK\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"GSI1SK\",\"KeyType\":\"RANGE\"}],\"Projection\":{\"ProjectionType\":\"ALL\"}},{\"IndexName\":\"GSI2\",\"KeySchema\":[{\"AttributeName\":\"GSI2PK\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"GSI2SK\",\"KeyType\":\"RANGE\"}],\"Projection\":{\"ProjectionType\":\"ALL\"}}]"

    aws dynamodb wait table-exists --table-name "$TABLE" --endpoint-url "$ENDPOINT" --region "$REGION"
    echo "Table $TABLE is ready."
    resolved=1
    break
  fi

  if is_connection_like_error "$describe_out"; then
    retry=$((retry + 1))
    echo "Waiting for DynamoDB Local at $ENDPOINT ($retry/$MAX_ATTEMPTS)..." >&2
    sleep "$SLEEP_SEC"
    continue
  fi

  echo "aws dynamodb describe-table failed:" >&2
  echo "$describe_out" >&2
  exit 1
done

if (( resolved == 0 )); then
  echo "Timed out waiting for DynamoDB Local at $ENDPOINT (no successful describe-table and no ResourceNotFoundException)." >&2
  exit 1
fi

# GET /api/health reads this row (same PK/SK as Terraform aws_dynamodb_table_item).
aws dynamodb put-item \
  --endpoint-url "$ENDPOINT" \
  --region "$REGION" \
  --table-name "$TABLE" \
  --item '{"PK":{"S":"health-check"},"SK":{"S":"BUILD"},"text":{"S":"local build"}}'

echo "Health-check item PK=health-check SK=BUILD set to text=local build."
