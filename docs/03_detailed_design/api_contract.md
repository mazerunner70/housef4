# API Contract V1

This document establishes the JSON payload bounds for the MVP based on the agreed ML & Personal Finance requirements. The **`frontend/`** client implements these shapes in `src/api/client.ts` and `src/lib/types.ts`.

**Persistence:** the **physical** storage layout in DynamoDB (table keys, `GSI1`, `entity_type` items, and attributes) is the companion document [`database/data_model.md`](./database/data_model.md). When API fields or resource shapes change, update that document together with this one so the wire format and the database stay aligned.

## Frontend client behavior

- **Base path**: requests use relative URLs under **`/api/...`**. In local Vite dev, `vite.config.ts` proxies `/api` to the backend (default target `http://localhost:3000`).
- **No client-side fixtures**: the SPA always calls the backend over HTTP; there is no in-browser mock dataset or simulated import parser in the frontend.
- **JSON field names**: snake_case is used for metrics and tag-rule responses; camelCase for the import summary. Match the examples below exactly.

## Date and time (JSON)

All date and datetime fields in JSON request and response bodies are **numbers: milliseconds since the Unix epoch (UTC)**. Do not use ISO-8601 strings on the wire—this keeps parsing unambiguous and avoids timezone string confusion.

## 1. Import Endpoint

Accepts a bank or PFM export file, parses it server-side into normalized transactions, persists them, writes a **transaction file** (import history) row per successful run, and returns a summary aligned with the import UI (`ImportParseResult`). Supported uploads include **CSV**, **OFX**, **QFX** (OFX variant), and **QIF**; the server detects format from filename and/or `Content-Type`. How raw file fields map into the app’s canonical transaction fields is specified in [`import_field_mapping.md`](./import_field_mapping.md).

**`POST /api/imports`**

### Request

- **`multipart/form-data`** with:
  - a single part **`file`** (the export binary or text), and
  - either **`new_account_name`** (non-empty string; the server creates an `ACCOUNT` row and links the file to it) or **`account_id`** (uuid of an existing account for this user; validated before ingest).
- If both are present, **`new_account_name`** takes precedence and a new account is created.
- Typical extensions: `.csv`, `.ofx`, `.qfx`, `.qif`. Relevant MIME types include `text/csv`, `application/x-ofx`, `application/vnd.intu.qfx`, `application/qif`, and `text/plain` when appropriate.

### Response Payload

```json
{
  "rowCount": 340,
  "knownMerchants": 290,
  "unknownMerchants": 50,
  "sourceFormat": "ofx",
  "importFileId": "550e8400-e29b-41d4-a716-446655440000",
  "existingTransactionsUpdated": 12,
  "newClustersTouched": 4
}
```

Optional fields are omitted when not applicable (e.g. `sourceFormat` when unknown).

| Field | Type | Notes |
|--------|------|--------|
| `rowCount` | number | Transaction rows successfully parsed and ingested. |
| `knownMerchants` | number | Rows matched to existing clusters or high-confidence categories. |
| `unknownMerchants` | number | Rows requiring cluster review (feeds review queue). |
| `sourceFormat` | string (optional) | One of: `csv`, `ofx`, `qfx`, `qif`. Omitted if the server cannot determine the format. |
| `importFileId` | string | Id of the persisted **transaction file** record for this import (see [`database/data_model.md`](./database/data_model.md) `TRANSACTION_FILE`). |
| `existingTransactionsUpdated` | number (optional) | Existing rows whose cluster or embeddings changed. |
| `newClustersTouched` | number (optional) | Distinct cluster ids in the new rows. |

After a successful import, subsequent **`GET /api/metrics`**, **`GET /api/transactions`**, **`GET /api/review-queue`**, **`GET /api/accounts`**, and **`GET /api/transaction-files`** responses must reflect the new data (including any new account).

### Accounts listing

**`GET /api/accounts`**

Returns the user’s financial **accounts** (for the import page dropdown), sorted by name.

```json
{
  "accounts": [
    {
      "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "name": "Chase Checking",
      "created_at": 1775044700000
    }
  ]
}
```

| Field | Type | Notes |
|--------|------|--------|
| `accounts` | array | Each item has `id` (string), `name` (string), `created_at` (epoch **ms** UTC). |

### Import history listing

**`GET /api/transaction-files`**

Returns recorded uploads (one item per successful `POST /api/imports` that wrote a `TRANSACTION_FILE` row), newest first.

```json
{
  "transaction_files": [
    {
      "user_id": "a1b2c3d4-…",
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "account_id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "source": {
        "name": "Statement.qfx",
        "size_bytes": 245800,
        "content_type": "application/vnd.intu.qfx"
      },
      "format": {
        "source_format": "qfx"
      },
      "timing": {
        "started_at": 1775044799000,
        "completed_at": 1775044800000
      },
      "result": {
        "rowCount": 340,
        "knownMerchants": 290,
        "unknownMerchants": 50,
        "existingTransactionsUpdated": 12,
        "newClustersTouched": 4
      }
    }
  ]
}
```

| Field | Type | Notes |
|--------|------|--------|
| `transaction_files` | array | Each item matches **`TransactionFileRecord`** in [`db/src/types.ts`](../../../db/src/types.ts). **`user_id`**, **`id`**, **`account_id`** (string; empty for legacy files before accounts), **`source`** (upload: `name`, `size_bytes`, optional `content_type`), **`format`** (optional `source_format` when detected), **`timing`** (`started_at` / `completed_at`, epoch **ms** UTC), **`result`** (**camelCase** — same shape as `POST /api/imports` batch summary: `ImportIngestResult`). Newest first by `timing.completed_at`. |

## 2. Metrics Baseline Endpoint

Provides the aggregated mathematical baseline for the dashboard. Transaction-derived fields are **normally read from** the persisted **`METRICS`** item (`entity_type: METRICS`, `SK: METRICS` — updated after each successful import and after tag-rule application); the server recomputes from transactions when that item is absent or unreadable.

**Rolling windows (UTC):** `monthly_cashflow` and `spending_by_category` reflect the **current UTC calendar month** (wall-clock “today”). `cashflow_history` includes **every UTC calendar month from the earliest stored transaction through the current month**, inclusive (oldest first). Months after the last transaction but up to “today” appear with zero inflow/outflow unless new data arrives.

**`GET /api/metrics`**

### Response Payload (core)

```json
{
  "monthly_cashflow": {
    "income": 4500.00,
    "expenses": 3200.00,
    "net": 1300.00
  },
  "net_worth": 12500.00,
  "spending_by_category": [
    { "category": "Housing & Utilities", "amount": 1500.00 },
    { "category": "Food & Groceries", "amount": 600.00 },
    { "category": "Subscriptions & Recurring", "amount": 100.00 },
    { "category": "Discretionary & Lifestyle", "amount": 1000.00 }
  ]
}
```

| Field | Type | Notes |
|--------|------|--------|
| `monthly_cashflow` | object | `income`, `expenses`, and `net` (all numbers). |
| `net_worth` | number | Current net worth. |
| `spending_by_category` | array | Each item has `category` (string) and `amount` (number). |

### Optional fields (dashboard UI)

The frontend mock and charts may supply additional optional fields; servers may omit them for a minimal implementation.

| Field | Type | Notes |
|--------|------|--------|
| `net_worth_change_pct` | number | Fractional change (e.g. `0.041` → +4.1% in UI). The server currently fills this as **month-over-month relative change in net cashflow** (not a stored net-worth time series). |
| `liquid_assets` | number | For extended net-worth breakdowns. |
| `liabilities` | number | For extended net-worth breakdowns. |
| `cashflow_period_label` | string | Subtitle for the cash-flow chart (e.g. date range). |
| `cashflow_history` | array | `{ "label": string, "income": number, "expenses": number }[]` for multi-month chart. |
| `spending_by_category[].budget` | number (optional) | When set on a row, category pacing UI can show spent vs budget. |

## 3. Transactions Endpoint

Provides the raw and mapped list of transactions.

**`GET /api/transactions`**

Optional query: **`transactionFileId`** (string, UUID of a persisted import / `TRANSACTION_FILE` row). When set, the response contains only transactions whose stored **`transaction_file_id`** matches that id (server uses DynamoDB **GSI2**). When omitted, behavior is unchanged: all transactions for the user.

### Response Payload

```json
{
  "transactions": [
    {
      "id": "txn_89101112",
      "date": 1775044800000,
      "raw_merchant": "Netflix.com",
      "cleaned_merchant": "NETFLIX",
      "amount": -15.99,
      "cluster_id": "CL_001",
      "category": "Subscriptions & Recurring",
      "status": "CLASSIFIED",
      "is_recurring": true,
      "transaction_file_id": "550e8400-e29b-41d4-a716-446655440000"
    },
    {
      "id": "txn_89101113",
      "date": 1775147400000,
      "raw_merchant": "SQ * LOCAL COFFEE",
      "cleaned_merchant": "SQ LOCAL COFFEE",
      "amount": -4.50,
      "cluster_id": "CL_005",
      "category": "Uncategorized",
      "status": "PENDING_REVIEW",
      "is_recurring": false,
      "transaction_file_id": "660e8400-e29b-41d4-a716-446655440001"
    }
  ]
}
```

| Field | Type | Notes |
|--------|------|--------|
| `transactions[].id` | string | Stable transaction identifier. |
| `transactions[].date` | number | Milliseconds since Unix epoch (UTC); see [Date and time (JSON)](#date-and-time-json). |
| `transactions[].amount` | number | Signed amount (negative for outflows). |
| `transactions[].status` | string | e.g. `CLASSIFIED`, `PENDING_REVIEW`. |
| `transactions[].cleaned_merchant` | string | Normalized merchant line for clustering and rules (see `transaction_analysis_clusters_and_categories.md`); always present on `GET /api/transactions` (derived when not stored). |
| `transactions[].transaction_file_id` | string | Id of the `TRANSACTION_FILE` import that created this row. |

Other fields follow the same snake_case names as in the example payload (`raw_merchant`, `cluster_id`, `category`, `is_recurring`).

## 4. Review Queue Endpoint

Fetches only clusters needing manual user mapping (Active Learning).

**`GET /api/review-queue`**

### Response Payload

```json
{
  "default_currency": "USD",
  "pending_clusters": [
    {
      "cluster_id": "CL_005",
      "sample_merchants": ["SQ * LOCAL COFFEE", "LOCAL COFFE PT"],
      "total_transactions": 14,
      "total_amount": 63.00,
      "suggested_category": null,
      "currency": "USD"
    }
  ]
}
```

| Field | Type | Notes |
|--------|------|--------|
| `default_currency` | string | User profile default (ISO 4217). Used to format amounts when `pending_clusters[].currency` is omitted. |
| `pending_clusters[].currency` | string (optional) | When set, from the import file metadata (e.g. OFX `CURDEF`) for the batch that last updated the cluster aggregate. |

## 5. Tag Rule Endpoint

Confirms a match from the review queue.

**`POST /api/rules/tag`**

### Request Payload

```json
{
  "cluster_id": "CL_005",
  "assigned_category": "Discretionary & Lifestyle"
}
```

### Response

```json
{
  "success": true,
  "updated_transactions": 14
}
```

| Field | Type | Notes |
|--------|------|--------|
| `updated_transactions` | number | Count of transaction rows updated by applying the rule. |

## 6. Backup & restore (user data safety)

Product requirements: **[`docs/01_discovery/stage_1_understanding_mvp.md`](../../01_discovery/stage_1_understanding_mvp.md)** §2 **Backup & restore**. Export creates a **portable snapshot** of the authenticated user’s **persisted application metadata** (DynamoDB entities — **not** raw import file bytes in V1); restore **fully replaces** all user-scoped application data covered by the backup — **no merge**, **no union** with existing rows (see [`database/data_model.md`](./database/data_model.md) §8).

**V1 engineering decisions (locked):**

| Topic | Decision |
|-------|-----------|
| Export transport | **Synchronous only** — `GET /api/backup/export` builds the full JSON in the Lambda/request lifecycle (no job queue in V1). |
| Payload scope | **Metadata / structured store only** — same entities as §8.1; **`transaction_files`** rows without embedding raw upload bytes (optional **`blob`** descriptors may be omitted). |
| Restore durability | **Staging table** — validate backup → write **staging** DynamoDB table → validate → delete user **partition** on **primary** (excluding lock row) → copy staging → primary → clear staging (§8.2). |
| Staging table name | Includes **`restores_in_progress`** — e.g. **`${project_id}-${environment}-restores-in-progress`** ([`database/data_model.md`](./database/data_model.md) §8.4). |
| Single-flight restore | **`RESTORE_LOCK`** item on **primary**, **`SK = SYSTEM#RESTORE_LOCK`** — **409** if lock already exists ([`database/data_model.md`](./database/data_model.md) §8.2a). |
| Worst-case size | **~15,000 transactions** per user (+ smaller entity counts); size Lambda/API timeouts and parallel **`BatchWriteItem`** accordingly ([`database/data_model.md`](./database/data_model.md) §8.2). |
| Abort stuck restore | **`POST /api/backup/restore/abort`** — **`RESTORE_LOCK`** on primary **first**, then staging partition ([`database/data_model.md`](./database/data_model.md) §8.2b); **does not** cancel an actively executing Lambda. |

### Backup export

**`GET /api/backup/export`**

Returns a single downloadable artifact representing the user’s restorable state (**synchronous** — caller waits until the JSON body is complete).

#### Response

- **Success:** **`200 OK`** with body **`application/json`** (UTF-8). Clients should persist it as a file (e.g. `housef4-backup-<timestamp>.json`). Optionally the server may send **`Content-Disposition: attachment`** with a suggested filename.
- **Headers:** `Content-Type: application/json; charset=utf-8`.

The JSON document MUST conform to the **logical backup snapshot** schema in [`database/data_model.md`](./database/data_model.md) §8 (`backup_schema_version`, `exported_at`, entity arrays). Field names inside entity records follow the same **`snake_case`** conventions as **`GET /api/transactions`**, **`GET /api/accounts`**, **`GET /api/transaction-files`**, and **`GET /api/review-queue`**—extended with any persisted attributes omitted from read APIs today only where required for a **lossless round-trip** (document those extensions in the data model).

#### Errors

| Status | Meaning |
|--------|---------|
| **401** | Unauthenticated. |
| **500** | Export failed (partial response body must not be sent as success — fail the request). |

**Limits:** V1 targets **up to ~15,000 transactions** per user (plus other entities). **`GET /api/backup/export`** must complete within Lambda/API limits — raise integration timeouts where supported; **parallelize** JSON assembly only if measured necessary. Async export remains **out of scope** until required.

---

### Restore (full overwrite)

**`POST /api/backup/restore`**

Replaces **all** application-owned rows for the authenticated user with the contents encoded in the uploaded backup file. Implementation follows **`database/data_model.md`** §8.2 **staging workflow** (validate → staging table → replace primary partition).

#### Request

- **`multipart/form-data`** with a single part **`backup`** — the **exact** JSON file bytes previously obtained from **`GET /api/backup/export`** (same `backup_schema_version` the server supports).
- **`Content-Type`** of the part should be `application/json` or `application/octet-stream`.

#### Response payload

```json
{
  "success": true,
  "restored": {
    "accounts": 2,
    "transactions": 340,
    "clusters": 12,
    "transaction_files": 5,
    "profile": true,
    "metrics": true
  },
  "completed_at": 1775044800000
}
```

| Field | Type | Notes |
|--------|------|--------|
| `success` | boolean | `true` when the **staging workflow** completed: primary table’s user partition matches the restored snapshot (see [`database/data_model.md`](./database/data_model.md) §8.2). |
| `restored` | object | Counts of rows written per collection; `profile` / `metrics` are booleans when those singleton items exist in the backup. |
| `completed_at` | number | Epoch **ms** UTC when restore finished. |

#### Errors

| Status | Meaning |
|--------|---------|
| **400** | Missing **`backup`** part, malformed JSON, unsupported **`backup_schema_version`**, failed semantic validation (e.g. transaction references unknown `transaction_file_id`). |
| **403** | Backup **`app_user_id`** (or equivalent identity field in §8) does not match the authenticated user — restore rejected to prevent cross-user data injection. |
| **401** | Unauthenticated. |
| **409** | Restore already in progress: **`RESTORE_LOCK`** row exists on primary (**`SYSTEM#RESTORE_LOCK`** — [`database/data_model.md`](./database/data_model.md) §8.2a). |
| **500** | Restore failed mid-workflow — see §8.2 **recovery** (retry copy from staging or ops intervention); clients should advise refresh after support confirms repair. |

#### Client obligations after success

Invalidate all cached queries (**transactions**, **metrics**, **review-queue**, **accounts**, **transaction-files**) and refetch or reload the SPA — identifiers from before restore may no longer exist.

---

### Abort restore cleanup (unlock after failure)

**`POST /api/backup/restore/abort`**

When **`RESTORE_LOCK`** is present (**restore flagged in progress**), the user may call this endpoint to **clear** that state and **delete their partition on the staging table**, so a **new** **`POST /api/backup/restore`** can run (**409** would otherwise block).

**V1 assumption:** This endpoint performs **cleanup only**. It **does not** signal or terminate a Lambda execution that is still processing a restore. Product stance for now: use abort **after** a restore attempt **already failed or stalled** (e.g. **500**, timeout, incomplete UI state leaving the lock behind — [`database/data_model.md`](./database/data_model.md) §8.2b).

**Processing order (mandatory):** **`DeleteItem`** **`RESTORE_LOCK`** on **primary** **first**, **then** paginated deletes on the **staging** partition ([`database/data_model.md`](./database/data_model.md) §8.2b). Rationale: **`409`** clears immediately; staging cleanup can span many batches without delaying unlock.

#### Request

- Empty body; **`POST`** with usual session **`Authorization`**.

#### Response payload

```json
{
  "success": true,
  "restore_lock_cleared": true,
  "staging_partition_cleared": true,
  "completed_at": 1775044800000
}
```

Example body when staging cleanup fails **after** lock removal (**`500`** status — **`success`** reflects outcome):

```json
{
  "success": false,
  "restore_lock_cleared": true,
  "staging_partition_cleared": false,
  "completed_at": 1775044800000
}
```

| Field | Type | Notes |
|--------|------|--------|
| `success` | boolean | **`true`** only on **`200`** when **both** lock handling (delete or absent) **and** staging cleanup **finished successfully**. **`false`** when returned with **`500`** partial failure body (see below). |
| `restore_lock_cleared` | boolean | **`true`** if **`RESTORE_LOCK`** (**`SYSTEM#RESTORE_LOCK`**) existed on primary and was deleted; **`false`** if there was no lock (**idempotent**). May be **`true`** on a **`500`** response if staging cleanup failed **after** the lock was removed (see below). |
| `staging_partition_cleared` | boolean | **`true`** only when staging **`Query`/`BatchWriteItem`** deletes **completed** for **`PK = USER#<user_id>`**. **`false`** on **`500`** if cleanup stopped mid-way (retry abort). |
| `completed_at` | number | Epoch **ms** UTC when abort cleanup finished (**includes partial attempts** — set when the handler exits). |

**Partial failure:** Because the lock is cleared **before** staging partition deletes finish, a timeout or throttle **during** staging cleanup may yield **`500`** **after** **`RESTORE_LOCK`** is already gone. Implementations **SHOULD** return a JSON body when practical with **`success`: `false`**, **`restore_lock_cleared`: `true`**, **`staging_partition_cleared`: `false`** so clients know **`409`** is lifted and they may **retry** **`POST /api/backup/restore/abort`** (**idempotent**) until **`200`** with **`staging_partition_cleared`: `true`** (staging empty). **`POST /api/backup/restore`** may proceed once **`restore_lock_cleared`** is effective even if staging still holds debris — the next restore’s step 2 **clears staging** before writing.

#### Errors

| Status | Meaning |
|--------|---------|
| **401** | Unauthenticated. |
| **500** | Unexpected failure **during lock delete and/or staging cleanup**. Retry abort (**idempotent**). If **`RESTORE_LOCK`** was already deleted, **`409`** will **not** apply on **`POST /api/backup/restore`**; retry abort until staging is drained if **`staging_partition_cleared`** remains **`false`**. |

### Alignment with discovery PRD

Restore semantics are **full overwrite only**: merging backup data with current DynamoDB rows is **explicitly out of scope** unless the PRD is revised.
