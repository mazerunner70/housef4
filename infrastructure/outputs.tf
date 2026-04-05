output "dynamodb_app_table_name" {
  description = "Application single-table DynamoDB name (housef4)"
  value       = aws_dynamodb_table.app_table.name
}

output "dynamodb_app_table_arn" {
  description = "Application DynamoDB table ARN"
  value       = aws_dynamodb_table.app_table.arn
}
