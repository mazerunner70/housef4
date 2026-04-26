# S3 Bucket for React Frontend (name is globally unique across all AWS accounts).
resource "aws_s3_bucket" "frontend_bucket" {
  # Globally unique: generic names like "frontend-host" collide across all AWS accounts.
  bucket        = "${var.project_id}-${var.environment}-frontend-${data.aws_caller_identity.current.account_id}"
  force_destroy = var.frontend_bucket_force_destroy

  # aws_s3_bucket Create runs: CreateBucket → HeadBucket wait → tags → resourceBucketUpdate.
  # S3 propagation can be slow; avoid overly aggressive timeouts that cause flaky applies.
  # If "Still creating..." exceeds create+update, Ctrl+C and check: VPN/DNS, or import if bucket exists.
  timeouts {
    create = "10m"
    read   = "10m"
    update = "10m"
    delete = "30m"
  }
}

# Block all public access (access should only be via CloudFront/OAC)
resource "aws_s3_bucket_public_access_block" "frontend_bucket_public_access" {
  bucket = aws_s3_bucket.frontend_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable server-side encryption by default
resource "aws_s3_bucket_server_side_encryption_configuration" "frontend_bucket_encryption" {
  bucket = aws_s3_bucket.frontend_bucket.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Enforce Object Ownership to bucket owner and disable ACLs (recommended for CloudFront OAC)
resource "aws_s3_bucket_ownership_controls" "frontend_bucket_ownership" {
  bucket = aws_s3_bucket.frontend_bucket.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Enable versioning for the frontend bucket
resource "aws_s3_bucket_versioning" "frontend_bucket_versioning" {
  bucket = aws_s3_bucket.frontend_bucket.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Single-table design: PK/SK for user-scoped entities; GSI1 for cluster → transactions (tag updates).
# Canonical attribute documentation: docs/03_detailed_design/database/data_model.md
resource "aws_dynamodb_table" "app_table" {
  name         = "${var.project_id}-${var.environment}-table"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }
}
