output "dynamodb_app_table_name" {
  description = "Application single-table DynamoDB name (housef4)"
  value       = aws_dynamodb_table.app_table.name
}

output "dynamodb_app_table_arn" {
  description = "Application DynamoDB table ARN"
  value       = aws_dynamodb_table.app_table.arn
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
