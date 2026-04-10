#!/usr/bin/env bash
# Delete the frontend S3 bucket in AWS (all objects + versions + policy) so Terraform can
# recreate it in aws_region (e.g. eu-west-2). Use when the bucket still lives in an old
# region and Terraform hits PermanentRedirect (301) on GetBucketPolicy.
#
# Usage:
#   ./scripts/delete-frontend-s3-bucket-aws.sh                    # uses terraform output
#   ./scripts/delete-frontend-s3-bucket-aws.sh housef4-dev-frontend-123456789
#
# Needs: aws CLI, jq, and terraform when omitting the bucket name (reads frontend_bucket_name output).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${TF_DIR:-"$ROOT/infrastructure"}"

if [[ -n "${1:-}" ]]; then
  BUCKET="$1"
else
  command -v terraform >/dev/null 2>&1 || {
    echo "terraform not found (required when bucket name is omitted)" >&2
    exit 1
  }
  BUCKET="$(terraform -chdir="$TF_DIR" output -raw frontend_bucket_name)"
fi

echo "Resolving region for s3://$BUCKET ..."
# get-bucket-location: pass any regional CLI --region (eu-west-2 is fine).
if ! raw="$(aws s3api get-bucket-location --bucket "$BUCKET" --region "${AWS_REGION:-eu-west-2}" --output json 2>&1)"; then
  echo "get-bucket-location failed (wrong name, insufficient permissions, or bucket already gone?):" >&2
  echo "$raw" >&2
  exit 1
fi
# null => us-east-1 (legacy)
LOC="$(echo "$raw" | jq -r '.LocationConstraint // empty')"
if [[ -z "$LOC" || "$LOC" == "null" ]]; then
  REG="us-east-1"
else
  REG="$LOC"
fi
echo "Bucket home region: $REG"

empty_versioned_bucket() {
  local bucket=$1
  local reg=$2
  # Delete current objects
  aws s3 rm "s3://${bucket}" --recursive --region "$reg" 2>/dev/null || true
  # Delete all versions + delete markers (batch up to 1000)
  while true; do
    local payload
    payload="$(aws s3api list-object-versions --bucket "$bucket" --region "$reg" --output json --max-keys 1000)"
    local count
    count="$(echo "$payload" | jq '[ .Versions // [], .DeleteMarkers // [] ] | flatten | length')"
    if [[ "$count" -eq 0 ]]; then
      break
    fi
    local del
    del="$(echo "$payload" | jq -c '{Objects: ([ .Versions[]? | {Key:.Key,VersionId:.VersionId} ] + [ .DeleteMarkers[]? | {Key:.Key,VersionId:.VersionId} ])}')"
    aws s3api delete-objects --bucket "$bucket" --region "$reg" --delete "$del" >/dev/null
  done
}

echo "Emptying bucket (including versioned objects) ..."
empty_versioned_bucket "$BUCKET" "$REG"

echo "Removing bucket policy (if any) ..."
aws s3api delete-bucket-policy --bucket "$BUCKET" --region "$REG" 2>/dev/null || true

echo "Deleting bucket ..."
aws s3api delete-bucket --bucket "$BUCKET" --region "$REG"

echo "OK: s3://$BUCKET removed. Run: terraform -chdir=$TF_DIR apply (recreates bucket in $AWS_REGION / your configured aws_region)."
