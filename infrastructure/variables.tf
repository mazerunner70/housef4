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

variable "health_check_build_label" {
  description = "Stored at DynamoDB PK=health-check SK=BUILD; surfaced as GET /api/health `build` and the /health-check page."
  type        = string
  default     = "prod build"
}

variable "cognito_allow_admin_password_auth" {
  description = "Allow ADMIN_USER_PASSWORD_AUTH on the SPA app client (needed for admin-initiate-auth in cognito-login-and-smoke and similar scripts). Set true for dev/smoke; false for hardened production pools."
  type        = bool
  default     = false
}

variable "frontend_bucket_force_destroy" {
  description = "If true, Terraform may delete the frontend S3 bucket even when non-empty. Prefer false outside ephemeral/dev stacks to avoid accidental data loss."
  type        = bool
  default     = false
}

variable "http_api_cors_allow_origins" {
  description = "Browser origins allowed to call the HTTP API cross-origin (e.g. Vite dev server). The SPA on the same CloudFront hostname as /api/* is same-origin and does not need to be listed. Add more origins if the SPA is hosted on a separate domain."
  type        = list(string)
  default = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
  ]
}
