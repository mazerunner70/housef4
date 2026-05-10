# housef4

Monorepo: React SPA (`frontend/`), API Lambda handlers (`backend/`), DynamoDB helpers (`db/`), Terraform (`infrastructure/`). Documentation index: **[`docs/README.md`](docs/README.md)**.

## Backend environment variables (backup & restore)

Restore uses a **second** DynamoDB table (staging). The API Lambda must receive **both** table names (**[`infrastructure/lambda_api.tf`](infrastructure/lambda_api.tf)**):

| Variable | Purpose |
|----------|---------|
| `DYNAMODB_TABLE_NAME` | Primary application single-table (`${project}-${env}-…` — see Terraform `aws_dynamodb_table.app_table`). |
| `DYNAMODB_RESTORE_STAGING_TABLE_NAME` | Restore staging replica; physical name **`${project_id}-${environment}-restores-in-progress`** (**[`infrastructure/dynamodb_restore_staging.tf`](infrastructure/dynamodb_restore_staging.tf)**). |
| `APP_ENV` | `local`, `staging`, or `production` — wired from Terraform **`var.app_env`**. |

**AWS:** Values are injected on deploy; **`terraform output dynamodb_restore_staging_table_name`** prints the staging table name after apply.

**Local:** Export the same variables (and optional **`DYNAMODB_ENDPOINT`**, **`DEV_AUTH_USER_ID`**, **`AWS_REGION`**) for the process running **`backend`** — patterns and safety notes live in **`[docs/03_detailed_design/backend_dev_and_prod_environments.md](docs/03_detailed_design/backend_dev_and_prod_environments.md)`**.

### QA & API reference

- **Manual scenarios** (export/restore round-trip, **`403`** / **`409`** / **`500`**, abort + retry): **[`docs/03_detailed_design/backup_restore_manual_qa.md`](docs/03_detailed_design/backup_restore_manual_qa.md)**
- **HTTP contract (status codes & bodies):** **[`docs/03_detailed_design/api_contract.md`](docs/03_detailed_design/api_contract.md) §6**
