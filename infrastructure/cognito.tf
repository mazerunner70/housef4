# Cognito User Pool + SPA public client for API Gateway HTTP API JWT authorizer (Step 3).

resource "aws_cognito_user_pool" "api" {
  name = "${var.project_id}-${var.environment}-user-pool"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.project_id}-${var.environment}-spa"
  user_pool_id = aws_cognito_user_pool.api.id

  generate_secret = false

  explicit_auth_flows = concat(
    [
      "ALLOW_USER_SRP_AUTH",
      "ALLOW_REFRESH_TOKEN_AUTH",
    ],
    var.cognito_allow_admin_password_auth ? ["ALLOW_ADMIN_USER_PASSWORD_AUTH"] : [],
  )

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
}
