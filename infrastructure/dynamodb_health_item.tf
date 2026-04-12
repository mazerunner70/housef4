# Row used by GET /api/health (`build` JSON field). Local dev uses scripts/ddb-local-bootstrap.sh ("local build").
resource "aws_dynamodb_table_item" "health_check" {
  table_name = aws_dynamodb_table.app_table.name
  hash_key   = aws_dynamodb_table.app_table.hash_key
  range_key  = aws_dynamodb_table.app_table.range_key

  item = jsonencode({
    PK = { S = "health-check" }
    SK = { S = "BUILD" }
    text = { S = var.health_check_build_label }
  })
}
