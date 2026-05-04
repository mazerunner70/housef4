# Housef4 Documentation

Welcome to the `housef4` monorepo.

## Structure

* `/frontend` - React + Vite SPA
* `/backend` - Node.js + TS Lambda Handlers
* `/db` - Database repository abstraction layer (DynamoDB wrapper)
* `/infrastructure` - Terraform definitions for AWS resources

## Documentation map

- **API wire format and endpoints:** `docs/03_detailed_design/api_contract.md` (including **`GET /api/transaction-files`**, **`GET /api/backup/export`**, **`POST /api/backup/restore`**, **`POST /api/backup/restore/abort`**)
- **Backup JSON schema by version:** `docs/03_detailed_design/backup-schema/` ([`README`](./03_detailed_design/backup-schema/README.md), current **[v1](./03_detailed_design/backup-schema/v1.md)**)
- **Persistent data (DynamoDB single-table, keys, GSI):** `docs/03_detailed_design/database/data_model.md` (includes **`TRANSACTION_FILE`** / `FILE#` items)
- **Transaction import, clustering, and cluster `cluster_id` lifecycle:** `docs/03_detailed_design/import_transaction_files.md`
- **UI routes & components (MVP journeys):** `docs/03_detailed_design/ui_component_flow.md`

## Setup

1. Run `pnpm install` in the root directory.
2. Ensure you have the `AWS_REGION` and AWS credentials configured.
3. Replace the `YOUR_TERRAFORM_STATE_BUCKET_NAME` in `infrastructure/backend.tf` to your S3 bucket.
