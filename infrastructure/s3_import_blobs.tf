resource "aws_s3_bucket" "import_blob_archive" {
  bucket        = "${var.project_id}-${var.environment}-import-blobs-${data.aws_caller_identity.current.account_id}"
  force_destroy = var.frontend_bucket_force_destroy

  lifecycle {
    prevent_destroy = false
  }

  tags = {
    Name        = "${var.project_id}-${var.environment}-import-blobs"
    Application = var.project_id
    Environment = var.environment
  }
}

resource "aws_s3_bucket_public_access_block" "import_blob_archive" {
  bucket = aws_s3_bucket.import_blob_archive.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "import_blob_archive" {
  bucket = aws_s3_bucket.import_blob_archive.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_ownership_controls" "import_blob_archive" {
  bucket = aws_s3_bucket.import_blob_archive.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}
