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

if ! aws dynamodb describe-table --table-name "$TABLE" --endpoint-url "$ENDPOINT" --region "$REGION" >/dev/null 2>&1; then
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
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --global-secondary-indexes \
      "[{\"IndexName\":\"GSI1\",\"KeySchema\":[{\"AttributeName\":\"GSI1PK\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"GSI1SK\",\"KeyType\":\"RANGE\"}],\"Projection\":{\"ProjectionType\":\"ALL\"}}]"

  aws dynamodb wait table-exists --table-name "$TABLE" --endpoint-url "$ENDPOINT" --region "$REGION"
  echo "Table $TABLE is ready."
else
  echo "Table $TABLE already exists at $ENDPOINT"
fi

# GET /api/health reads this row (same PK/SK as Terraform aws_dynamodb_table_item).
aws dynamodb put-item \
  --endpoint-url "$ENDPOINT" \
  --region "$REGION" \
  --table-name "$TABLE" \
  --item '{"PK":{"S":"health-check"},"SK":{"S":"BUILD"},"text":{"S":"local build"}}'

echo "Health-check item PK=health-check SK=BUILD set to text=local build."
