variable "aws_region" {
  description = "AWS region (all resources, including S3 frontend bucket)"
  type        = string
  default     = "eu-west-2"
}

variable "project_id" {
  description = "Application name prefix for resources (housef4)"
  type        = string
  default     = "housef4"
}

variable "environment" {
  description = "Deployment slice (e.g., dev, staging, prod) — used in resource names and tags"
  type        = string
  default     = "dev"
}

variable "app_env" {
  description = "APP_ENV on Lambda (staging or production only — never local in AWS)."
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.app_env)
    error_message = "app_env for AWS must be staging or production."
  }
}

variable "lambda_runtime" {
  description = "Node.js runtime for the API Lambda"
  type        = string
  default     = "nodejs20.x"
}

variable "lambda_memory_size" {
  description = "Lambda memory in MB"
  type        = number
  default     = 256
}

variable "lambda_timeout" {
  description = "Lambda timeout in seconds"
  type        = number
  default     = 10
}

variable "cognito_allow_admin_password_auth" {
  description = "Allow ADMIN_USER_PASSWORD_AUTH for aws cognito-idp admin-initiate-auth (smoke tests only). Set false for hardened production pools."
  type        = bool
  default     = true
}
