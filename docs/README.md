# Housef4 Documentation

Welcome to the `housef4` monorepo.

## Structure

* `/frontend` - React + Vite SPA
* `/backend` - Node.js + TS Lambda Handlers
* `/db` - Database repository abstraction layer (DynamoDB wrapper)
* `/infrastructure` - Terraform definitions for AWS resources

## Documentation map

- **API wire format and endpoints:** `docs/03_detailed_design/api_contract.md` (including **`GET /api/transaction-files`**, **`GET /api/backup/export`**, **`POST /api/backup/restore`**, **`POST /api/backup/restore/abort`**)
- **Backup/restore manual QA & env prerequisites:** [`03_detailed_design/backup_restore_manual_qa.md`](./03_detailed_design/backup_restore_manual_qa.md) — links to **`api_contract.md`** §6 and root **`README`** table for **`DYNAMODB_RESTORE_STAGING_TABLE_NAME`**
- **Backup JSON schema by version:** `docs/03_detailed_design/backup-schema/` ([`README`](./03_detailed_design/backup-schema/README.md), current **[v1](./03_detailed_design/backup-schema/v1.md)**)
- **Persistent data (DynamoDB single-table, keys, GSI):** `docs/03_detailed_design/database/data_model.md` (includes **`TRANSACTION_FILE`** / `FILE#` items)
- **Transaction import (orchestration, clustering, opaque **`cluster_id`** mints incl. singletons, **§8.7 now/next staging**):** [`03_detailed_design/import_transaction_files.md`](./03_detailed_design/import_transaction_files.md) — **Linear delivery plan / review slicing:** [`01_discovery/linear/import_pipeline_orchestration_delivery.md`](./01_discovery/linear/import_pipeline_orchestration_delivery.md)
- **DynamoDB import staging table & `IMPORT_LOCK`:** [`03_detailed_design/database/data_model.md`](./03_detailed_design/database/data_model.md) §8.5
- **Internal transfers (`pairing_id`), canonical amount signs, clustering exclusion:** [`03_detailed_design/transfer_matching.md`](./03_detailed_design/transfer_matching.md) — **implementation reasoning (centre / sliding window):** [`transfer_matching_centre_window_algorithm.md`](./03_detailed_design/transfer_matching_centre_window_algorithm.md)
- **UI routes & components (MVP journeys):** `docs/03_detailed_design/ui_component_flow.md`

## Setup

1. Run `pnpm install` in the root directory.
2. Ensure you have the `AWS_REGION` and AWS credentials configured.
3. Replace the `YOUR_TERRAFORM_STATE_BUCKET_NAME` in `infrastructure/backend.tf` to your S3 bucket.
