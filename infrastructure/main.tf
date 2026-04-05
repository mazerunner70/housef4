variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

# Example of defining the CloudFront Distribution, API Gateway, S3 bucket, Lambda
# ...

# S3 Bucket for React Frontend
resource "aws_s3_bucket" "frontend_bucket" {
  bucket = "housef4-frontend-bucket-${data.aws_caller_identity.current.account_id}"
}

# DynamoDB Table for application data
resource "aws_dynamodb_table" "app_table" {
  name         = "housef4-table"
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
}

data "aws_caller_identity" "current" {}
