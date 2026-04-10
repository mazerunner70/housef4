# API Lambda: packaged compiled output of ../backend (no Docker in this stack).

locals {
  backend_dist_dir = abspath("${path.module}/../backend/dist")
}

check "backend_dist_built" {
  assert {
    condition     = fileexists("${local.backend_dist_dir}/index.js")
    error_message = "Build the backend before terraform plan/apply: `pnpm --filter @housef4/backend run build` from the repo root."
  }
}

data "archive_file" "backend_lambda" {
  type        = "zip"
  source_dir  = local.backend_dist_dir
  output_path = "${path.module}/.build/backend_lambda.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    effect  = "Allow"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api_lambda" {
  name               = "${var.project_id}-${var.environment}-api-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "api_lambda_basic" {
  role       = aws_iam_role.api_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "api_lambda_dynamodb" {
  name = "${var.project_id}-${var.environment}-api-ddb"
  role = aws_iam_role.api_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AppTable"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
        ]
        Resource = [
          aws_dynamodb_table.app_table.arn,
          "${aws_dynamodb_table.app_table.arn}/index/*",
        ]
      }
    ]
  })
}

resource "aws_lambda_function" "api" {
  function_name = "${var.project_id}-${var.environment}-api"
  role          = aws_iam_role.api_lambda.arn
  handler       = "index.handler"
  runtime       = var.lambda_runtime
  memory_size   = var.lambda_memory_size
  timeout       = var.lambda_timeout

  filename         = data.archive_file.backend_lambda.output_path
  source_code_hash = data.archive_file.backend_lambda.output_base64sha256

  environment {
    variables = {
      APP_ENV             = var.app_env
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.app_table.name
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.api_lambda_basic,
  ]
}

resource "aws_apigatewayv2_api" "http" {
  name          = "${var.project_id}-${var.environment}-http"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id             = aws_apigatewayv2_api.http.id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  integration_uri    = aws_lambda_function.api.invoke_arn

  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_route" "api_proxy" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "ANY /api/{proxy+}"

  target = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
