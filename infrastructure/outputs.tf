output "aws_region" {
  description = "AWS region used by this stack (for e.g. VITE_COGNITO_REGION when building the SPA)"
  value       = var.aws_region
}

output "dynamodb_app_table_name" {
  description = "Application single-table DynamoDB name (housef4)"
  value       = aws_dynamodb_table.app_table.name
}

output "dynamodb_app_table_arn" {
  description = "Application DynamoDB table ARN"
  value       = aws_dynamodb_table.app_table.arn
}

output "dynamodb_restore_staging_table_name" {
  description = "Restore staging DynamoDB table name (backup/restore workflow; data_model.md §8.4)"
  value       = aws_dynamodb_table.restore_staging.name
}

output "dynamodb_restore_staging_table_arn" {
  description = "Restore staging DynamoDB table ARN"
  value       = aws_dynamodb_table.restore_staging.arn
}

output "lambda_api_function_name" {
  description = "API Lambda function name"
  value       = aws_lambda_function.api.function_name
}

output "lambda_api_function_arn" {
  description = "API Lambda ARN"
  value       = aws_lambda_function.api.arn
}

output "api_gateway_http_endpoint" {
  description = "HTTP API invoke URL (direct; paths like /api/health)"
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "api_gateway_http_id" {
  description = "HTTP API id"
  value       = aws_apigatewayv2_api.http.id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution id (invalidate after frontend deploy)"
  value       = aws_cloudfront_distribution.app.id
}

output "cloudfront_domain_name" {
  description = "CloudFront hostname — use https://<this> for SPA + /api/* to Lambda"
  value       = aws_cloudfront_distribution.app.domain_name
}

output "frontend_bucket_name" {
  description = "S3 bucket for Vite build artifacts (sync via CI or aws s3 sync)"
  value       = aws_s3_bucket.frontend_bucket.id
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool id (JWT issuer path segment)"
  value       = aws_cognito_user_pool.api.id
}

output "cognito_spa_client_id" {
  description = "Cognito app client id (JWT audience for API Gateway authorizer)"
  value       = aws_cognito_user_pool_client.spa.id
}

output "cognito_jwt_issuer" {
  description = "JWT issuer URL for Cognito (verify tokens / frontend config)"
  value       = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.api.id}"
}
