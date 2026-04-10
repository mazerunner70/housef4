terraform {
  required_version = ">= 1.10.0"
  # S3 backend use_lockfile needs 1.10+ (native lock objects in the state bucket).

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

data "aws_caller_identity" "current" {}

provider "aws" {
  region = var.aws_region
  # Default is 25; lowering avoids very long retry storms when S3/API calls stall (see aws provider docs).
  max_retries = 5

  default_tags {
    tags = {
      Project     = var.project_id
      Environment = var.environment
    }
  }
}
