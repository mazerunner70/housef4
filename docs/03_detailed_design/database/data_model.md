---
title: Application data model (DynamoDB)
stage: Detailed Design
phase: Database
---

# Application data model (DynamoDB)

This is the **canonical description** of how persisted application data is stored in the production table. The HTTP JSON shapes in [`../api_contract.md`](../api_contract.md) are the **API contract**; this document is the **physical** layout: keys, GSI, and attributes the repository writes.

| Artifact | Role |
|----------|------|
| [`db/src/types.ts`](../../../db/src/types.ts) | TypeScript record shapes (aligned with the API; omits `PK` / `SK` / `GSI1*`). |
| [`db/src/keys.ts`](../../../db/src/keys.ts) | Key string helpers: `USER#`, `TXN#`, `CLUSTER#`, `FILE#`, GSI1 composite keys. |
| [`db/src/dynamoFinanceRepository.ts`](../../../db/src/dynamoFinanceRepository.ts) | Read and write implementation (queries, batch writes, tag rules, `recordTransactionFile` / `listTransactionFiles`). |
| [`db/src/dashboardMetrics.ts`](../../../db/src/dashboardMetrics.ts) | Pure helpers: `computeDashboardMetrics`, `parseStoredDashboardMetrics` (transaction-derived dashboard snapshot). |
| [`db/src/userPartition.ts`](../../../db/src/userPartition.ts) | Paginated user-partition `Query` / batch deletes (`dataset` selects `DYNAMODB_TABLE_NAME` vs `DYNAMODB_RESTORE_STAGING_TABLE_NAME`); restore lock helpers target **primary** only. |
| [`infrastructure/main.tf`](../../../infrastructure/main.tf) | `aws_dynamodb_table` definition (hash/range, GSI1). |
| `infrastructure/dynamodb_health_item.tf` | System row `PK=health-check`, `SK=BUILD` for health metadata (out of application domain). |

**Maintenance:** If you add attributes, a new GSI, or change key conventions, update **this file** in the same change as `db/`, `infrastructure/`, and any API updates to [`../api_contract.md`](../api_contract.md). The local PostgreSQL schema in `ml-training/schema.sql` is for notebooks only; keep it roughly aligned in spirit, but it is not the source of truth for production.

---

## Table: single-table design

- **Table name (Terraform):** `${project_id}-${environment}-table` (see `infrastructure/main.tf` outputs).
- **Billing:** `PAY_PER_REQUEST` (on-demand).
- **Base table keys**
  - **`PK`** (String) — partition key. User-scoped application rows use `USER#<user_id>`.
  - **`SK`** (String) — sort key. Distinguishes entity type and id: `TXN#<transaction_id>`, `CLUSTER#<cluster_id>`, `FILE#<file_id>`, literal `PROFILE`, literal **`METRICS`** (dashboard aggregates), `SYSTEM#RESTORE_LOCK` (restore single-flight lock — see §8.2a), or `ACCOUNT#…`.
- **Global secondary index: `GSI1`**
  - **GSI1PK** (String) — `USER#<user_id>#CLUSTER#<cluster_id>` (see `clusterTxnGsi1Pk` in `db/src/keys.ts`). Enables all transactions in a **cluster** for a user to be found without a table scan.
  - **GSI1SK** (String) — `TXN#<transaction_id>` (same as base `SK` for that transaction) via `clusterTxnGsi1Sk`.
  - **Projection:** `ALL` (full item image on the index).
- **Global secondary index: `GSI2`**
  - **GSI2PK** (String) — `USER#<user_id>#FILE#<transaction_file_id>` (`fileTxnGsi2Pk`). Enables all transactions **created in one import file** for batch review.
  - **GSI2SK** (String) — `TXN#<transaction_id>` (`fileTxnGsi2Sk`).
  - **Projection:** `ALL`.

Access patterns: list user transactions and clusters by **base table** query on `PK` + `SK` prefix; list / update all transactions in a **cluster** (e.g. tag rules) by **GSI1** query on `GSI1PK`; list transactions for an import by **GSI2** query on `GSI2PK`.

---

## Entity discriminator

Every application item (except the health system row) includes:

| Attribute | Type | Description |
|-----------|------|-------------|
| **`entity_type`** | String | `TRANSACTION`, `CLUSTER`, `TRANSACTION_FILE`, `ACCOUNT`, `PROFILE`, `METRICS`, or **`RESTORE_LOCK`**. Used when reading and filtering. |

---

## 1. Transaction (`entity_type: TRANSACTION`)

**Keys**

| Key | Value pattern |
|-----|----------------|
| `PK` | `USER#<user_id>` |
| `SK` | `TXN#<transaction_id>` |
| `GSI1PK` | `USER#<user_id>#CLUSTER#<cluster_id>` |
| `GSI1SK` | `TXN#<transaction_id>` |
| `GSI2PK` | `USER#<user_id>#FILE#<transaction_file_id>`|
| `GSI2SK` | `TXN#<transaction_id>` |

**Attributes (persisted)** — see `DynamoFinanceRepository.ingestImportBatch` / `patchExistingTransactionsAfterImport` / `listTransactions`.

| Attribute | Type | Notes |
|-----------|------|--------|
| `user_id` | String | Redundant with `PK` for convenience. |
| `id` | String | Transaction id (UUID). |
| `date` | Number | **Epoch milliseconds UTC** (same convention as the API). |
| `raw_merchant` | String | As imported. |
| `cleaned_merchant` | String | Normalized merchant line for clustering. |
| `amount` | Number | Sign per product rules (e.g. spending negative). |
| `cluster_id` | String or absent / null (when implemented) | Merchant cluster / stable id for rules and `GSI1`. Optional once [`../import_transaction_files.md`](../import_transaction_files.md) allows unassigned rows. |
| `category` | String | Current assigned category. |
| `status` | String | `CLASSIFIED` \| `PENDING_REVIEW`. |
| `is_recurring` | Boolean | Recurring flag. |
| `merchant_embedding` | List of numbers | Optional; e.g. 384-dim vector when present. |
| `suggested_category` | String or null | From rules / ML. |
| `category_confidence` | Number | Optional. |
| `match_type` | String | Optional; how the row was matched. |
| `transaction_file_id` | String | Id of the `TRANSACTION_FILE` row for the import that **inserted** this transaction (same id as in `SK` of `FILE#…`). Required on every transaction row. |
| `GSI2PK` / `GSI2SK` | String | Denormalized keys for **GSI2** (see above); always set with `transaction_file_id` on insert. |

---

## 2. Cluster (`entity_type: CLUSTER`)

Represents a merchant **cluster** row for the review queue, aggregates, and tag rules. **Key:**

| Key | Value pattern |
|-----|----------------|
| `PK` | `USER#<user_id>` |
| `SK` | `CLUSTER#<cluster_id>` |

**Attributes (persisted)** — `ingestImportBatch`, `listPendingClusters`, `applyTagRule`.

| Attribute | Type | Notes |
|-----------|------|--------|
| `cluster_id` | String | Same as embedded in `SK`. |
| `sample_merchants` | String[] | Sample text for UI (capped/merged in code). |
| `total_transactions` | Number | Running count. |
| `total_amount` | Number | Typically sum of abs(amount) contributions. |
| `currency` | String (optional) | ISO 4217, denormalized from the import when known; preserved on later ingests that do not supply a new code. |
| `suggested_category` | String or null | From batch / rules. |
| `assigned_category` | String or null | User or rule assignment. |
| `pending_review` | Boolean | `true` if still in review (filtered in review-queue listing). |

Clusters do not project to GSI1; transactions carry GSI1 for “all txns in cluster” updates.

---

## 3. Transaction file (`entity_type: TRANSACTION_FILE`)

Per-upload **import history**: the uploaded file, how it was classified, when processing ran, and the batch outcome. The **current** write shape is **`TransactionFileInput`** in [`db/src/types.ts`](../../../db/src/types.ts) plus `user_id` on the wire — the **`TransactionFileRecord`** type. Attributes are grouped to match the import **lifecycle** (source → format detection → timing → result). Created after a successful `POST /api/imports` (including zero-row parses). **Keys:**

| Key | Value pattern |
|-----|----------------|
| `PK` | `USER#<user_id>` |
| `SK` | `FILE#<file_id>` (UUID) |

**Attributes (current writes)** — `recordTransactionFile` / `listTransactionFiles` (see `DynamoFinanceRepository`).

| Attribute | Type | Notes |
|-----------|------|--------|
| `id` | String | Same as in `SK` after the `FILE#` prefix. |
| `account_id` | String | Id of the user’s `ACCOUNT` item (`ACCOUNT#…` sort key id segment) for this file. Omitted on legacy items; readers treat missing as empty. |
| **`source`** | Map (object) | **§1 — Multipart / upload audit:** `name` (client filename or display default), `size_bytes`, optional `content_type` (part MIME). |
| **`format`** | Map (object) | **§2 — Import source type for parsing** (set after sniffing): optional `source_format` (e.g. `csv` / `ofx` / `qfx` / `qif`); optional `currency` (ISO 4217) when inferrable (e.g. OFX `CURDEF`); may be empty if unknown. |
| **`timing`** | Map (object) | **§3 — Clock (epoch ms UTC):** `started_at` (after a successful multipart extract, before parse/enrich/ingest), `completed_at` (when the run finishes and the item is written). **Listing order** (newest first) uses `timing.completed_at`. |
| **`result`** | Map (object) | **§4 — Batch summary** — full **`ImportIngestResult`**: `rowCount`, `knownMerchants`, `unknownMerchants`, `existingTransactionsUpdated`, `newClustersTouched` (the last two include re-cluster patch effects where applicable; see [`db/src/types.ts`](../../../db/src/types.ts)). |

Does not use GSI1. Listed via base-table query: `PK = USER#<user_id>` and `SK` begins with `FILE#`.

**Legacy items (read path):** some rows may pre-date this layout and still store top-level `name` / `imported_at` / `row_count`, maps named **`file_import`** (source + optional `source_format` combined) and **`ingest`** (outcome), or loose `source_format` on the item. The repository **normalizes** these to the same **`TransactionFileRecord`** shape for `listTransactionFiles` and **`GET /api/transaction-files`**, using `imported_at` to populate `timing.completed_at` (and a conservative `started_at` when only completion time is known).

**Schema changes / existing data:** the project is **not** doing automated backfills for this entity in early phases. If attributes change or items are inconsistent, **delete the affected DynamoDB items (or the user’s prefix in non-prod) after explicit approval**; full migration tooling can wait until much later. Prefer removing stale `TRANSACTION_FILE` items over ad-hoc in-place rewrites.

---

## 4. Account (`entity_type: ACCOUNT`)

A user-labeled **financial account** (e.g. “Chase Checking”) so each import can be associated with a stable id. **Keys:**

| Key | Value pattern |
|-----|---------------|
| `PK` | `USER#<user_id>` |
| `SK` | `ACCOUNT#<account_id>` (UUID) |

| Attribute | Type | Notes |
|-----------|------|--------|
| `id` | String | Same as the UUID in `SK` after `ACCOUNT#`. |
| `name` | String | User-visible label (trimmed on create). |
| `created_at` | Number | Epoch **ms** UTC. |

Created via `POST /api/imports` when the client sends **`new_account_name`**, or via the same code path the handler uses. Listed with `begins_with(SK, ACCOUNT#)` (see `listAccounts`).

---

## 5. Profile (`entity_type: PROFILE`)

One item per user for **user-level settings** (not transaction-derived dashboard aggregates). **Key:**

| Key | Value pattern |
|-----|----------------|
| `PK` | `USER#<user_id>` |
| `SK` | `PROFILE` (constant, see `PROFILE_SK` in `db/src/keys.ts`) |

**Attributes:** `net_worth` (Number) is written on create (`ensureProfile`); `getMetrics` merges the live `net_worth` into the API response with data read from the **`METRICS`** item (see below). Optional `default_currency` (String, ISO 4217) may be set for display; when absent, APIs default to `USD`.

---

## 6. Metrics (`entity_type: METRICS`)

One item per user holding the **cached dashboard snapshot** derived from transactions (same logical shape as transaction-derived fields on **`GET /api/metrics`**, excluding `net_worth`). **Key:**

| Key | Value pattern |
|-----|----------------|
| `PK` | `USER#<user_id>` |
| `SK` | `METRICS` (constant, see `METRICS_SK` in `db/src/keys.ts`) |

**Attributes:** `user_id` (String); **`metrics_updated_at`** (Number, epoch ms UTC); **`monthly_cashflow`** (Map: `income`, `expenses`, `net` — **current UTC month**); **`spending_by_category`** (List of maps: `category`, `amount` — same month); **`cashflow_history`** (List of maps: `label`, `income`, `expenses` — one row per UTC month from **earliest transaction** through **current month**, oldest first); **`cashflow_period_label`** (String); optional **`net_worth_change_pct`** (Number — month-over-month **net cashflow** change ratio). See [`../api_contract.md`](../api_contract.md) §2. Written by `refreshStoredDashboardMetrics` after **`POST /api/imports`** and after **`applyTagRule`**. Does not use GSI1/GSI2. If the item is missing or invalid, `getMetrics` recomputes from a full transaction list (no write).

---

## 7. Health system row (non-domain)

A Terraform-managed item supports build/version health checks. It is **not** a user or application entity. See `infrastructure/dynamodb_health_item.tf` (`PK=health-check`, `SK=BUILD`).

---

## 8. Logical backup snapshot (export file — not a Dynamo row)

Backups are **artifacts** (JSON files on disk after download), not rows in this table. This section defines what a **[`GET /api/backup/export`](../api_contract.md)** produces and what **`POST /api/backup/restore`** must reinstantiate as Dynamo items under **`PK = USER#<user_id>`**.

**Product rule ([PRD](../../01_discovery/stage_1_understanding_mvp.md)):** restore **fully overwrites** user-scoped application data — **no merge** with existing items.

**V1 scope:** backups contain **structured DynamoDB-round-trippable metadata only** — **not** raw bytes of original bank uploads. Omit **`blob`** / object-storage payloads from `TRANSACTION_FILE` entries in the JSON (optional descriptors may be added in a later schema version when blob export is implemented).

### 8.1 Envelope (top-level JSON)

| Field | Type | Notes |
|-------|------|--------|
| **`backup_schema_version`** | Number | Monotonic integer; server accepts only versions it implements (reject older/newer as **400** until migrated). Start at **`1`** for V1. |
| **`exported_at`** | Number | Epoch **ms** UTC when export ran. |
| **`app_user_id`** | String | Cognito **`sub`** / owning user id. **`POST /api/backup/restore`** MUST reject the file if this does not match the authenticated user (**403**). |
| **`accounts`** | Array | Objects aligned with **`GET /api/accounts`** plus any persisted fields needed for round-trip (`id`, `name`, `created_at`). |
| **`profile`** | Object or null | Maps to **§5 Profile** attributes (`default_currency`, `net_worth`, …). |
| **`metrics`** | Object or null | Maps to **§6 Metrics** cached snapshot attributes (optional — may be recomputed after restore instead). |
| **`transactions`** | Array | Objects aligned with **`GET /api/transactions`** plus persistence-only fields required for **§1 Transaction**: **`merchant_embedding`**, **`suggested_category`**, **`category_confidence`**, **`match_type`** when present. Must include **`transaction_file_id`** and consistent **`cluster_id`** references. |
| **`clusters`** | Array | Objects aligned with review-queue cluster records and **§2 Cluster** persistence (`cluster_id`, aggregates, `assigned_category`, `pending_review`, …). |
| **`transaction_files`** | Array | **`TRANSACTION_FILE`** metadata only (**§3** maps: `source`, `format`, `timing`, `result`, ids, `account_id`). **V1:** do **not** embed raw file contents or S3 object bodies; see [`import_file_blob_storage.md`](../import_file_blob_storage.md) for future blob-inclusive backups. |

Implementations may add **`_meta`** (generator version, row counts) if present keys remain forward-compatible.

### 8.2a Restore in-progress lock (`entity_type: RESTORE_LOCK`)

Explicit **single-flight** marker on the **primary** table so **`POST /api/backup/restore`** returns **409** while a restore is underway and so read APIs / UI can detect “restore running” without inferring from staging alone.

| Key | Value pattern |
|-----|----------------|
| `PK` | `USER#<user_id>` |
| `SK` | **`SYSTEM#RESTORE_LOCK`** (constant — add e.g. `RESTORE_LOCK_SK` in `db/src/keys.ts`) |

**Attributes (suggested):** `user_id` (String); **`restore_started_at`** (Number, epoch ms UTC); optional **`backup_schema_version`** (Number). Does **not** use GSI1/GSI2.

**Lifecycle**

- **Acquire:** **`PutItem`** with **`ConditionExpression`** **`attribute_not_exists(SK)`** (and keys **`PK`/`SK`** set to the user partition + **`SYSTEM#RESTORE_LOCK`**) so only **one** lock row exists per user. If the item already exists → **409 Conflict** on restore entry.
- **Preserve during destructive steps:** When deleting the user **partition** on primary (§8.2 step 5), **omit** `SK = SYSTEM#RESTORE_LOCK` from deletes until the workflow finishes successfully (or fails and runs explicit cleanup).
- **Release:** **`DeleteItem`** on the lock row **after** staging → primary copy **and** staging cleanup succeed (and optional verification). **User-initiated cleanup:** **`POST /api/backup/restore/abort`** ([`../api_contract.md`](../api_contract.md) §6) removes the lock and clears the staging partition when restore **already stopped** — §8.2b. Otherwise rely on ops runbooks until stopped execution allows abort.

Optional future **`GET /api/me`** (or profile payload) may expose **`restore_in_progress: true`** derived from presence of this row.

### 8.2 Restore write semantics (full overwrite — staging table workflow)

DynamoDB does **not** offer a single multi-item transaction that spans an arbitrary user-sized dataset. V1 therefore uses **two tables** with the **same key design and GSIs** as the primary application table:

| Table | Role |
|-------|------|
| **Primary** | Production single-table (`USER#…` items live here today). |
| **Restore staging** | Same partition/sort key conventions and attribute shapes; DynamoDB table **name includes `restores_in_progress`** (e.g. **`${project_id}-${environment}-restores-in-progress`** in Terraform). Holds **only** transient restore payloads keyed by **`PK = USER#<user_id>`** during an in-flight restore. |

**Partition scope:** All staging writes, staging deletes, primary deletes for the swap, and staging→primary **copy** operate on **this user’s partition only** — **`PK = USER#<user_id>`**. Never **`Scan`** the full staging table for routine restore.

**Operational sizing (V1 target):** Plan for **up to ~15,000 transactions** per user (plus hundreds of non-transaction items). At **25 items per `BatchWriteItem`**, transaction writes alone need **~600** batch requests per direction (staging load + primary copy); use **parallel** batch workers within Lambda concurrency limits. Size **Lambda timeout** (e.g. toward **15 minutes** max) and **API Gateway integration timeout** (raise to match where the gateway product allows) so a worst-case restore can complete **synchronously** in V1; if limits block, defer **async restore** to a later epic.

**Workflow (validate, then replace):**

0. **Acquire restore lock** on **primary**: conditional **`PutItem`** **`RESTORE_LOCK`** (§8.2a). If lock exists → **409**.
1. **Parse & semantic validate** the backup JSON **in memory**: `backup_schema_version`, **`app_user_id`** vs authenticated user (**403**), referential integrity (`transaction_file_id`, cluster references, etc.). Fail with **400** before touching DynamoDB — then **release lock** if validation fails before any staging write.
2. **Clear staging partition:** delete every item with **`PK = USER#<user_id>`** on the **staging** table (paginated `Query` + `BatchWriteItem` **`DeleteRequest`**). Ensures no leftover rows from an aborted prior restore.
3. **Materialize** validated items as full DynamoDB attribute maps (including **`GSI1*` / `GSI2*`** on transactions) and **batch write** them to the **staging** table only — same **`PK`/`SK`** pattern they will use on primary (see §§1–6). **Do not** write **`RESTORE_LOCK`** or **`SYSTEM#RESTORE_LOCK`** into staging from backup JSON (lock is primary-only operational metadata).
4. **Validate materialized data** (lightweight): e.g. counts vs backup arrays, spot-check required attributes on a sample transaction; optional conditional **`TransactWriteItems`** checks only where small. Any failure → **stop**, respond **500**, **primary untouched** except lock — **release lock** after staging cleanup policy is defined (or leave lock + staging for ops retry).
5. **Replace primary user data (not the lock yet):** paginated **delete** every application item on **primary** with **`PK = USER#<user_id>`** and **`SK`** matching **`TXN#`**, **`CLUSTER#`**, **`FILE#`**, **`ACCOUNT#`**, literal **`PROFILE`**, literal **`METRICS`** — **exclude** **`SK = SYSTEM#RESTORE_LOCK`**. Never touch **`health-check`** or other partitions.
6. **Copy staging → primary:** `Query` staging for **`PK = USER#<user_id>`** (paginated), **`BatchWriteItem`** **`PutRequest`** identical items onto **primary**. Parallelize batch fan-out where safe; **retry** idempotently on throttle.
7. **Clear staging partition** for this user (same pattern as step 2).
8. **Metrics refresh:** if backup omitted **`metrics`** or product prefers recompute, call **`refreshStoredDashboardMetrics`** after primary writes complete.
9. **`DeleteItem`** **`RESTORE_LOCK`** (`SYSTEM#RESTORE_LOCK`) on primary.

**Why two tables:** Step 4 proves the backup **materializes** cleanly before **any destructive delete** of user data on primary (except the lock row). Steps 5–6 still leave a **finite vulnerability window** after deletes begin; mitigation is **idempotent retry** of step 6 from staging if copy fails **before** staging is cleared — **do not clear staging** until primary copy **and** optional read-back verification succeed.

**Operational caveats:** Lambda timeouts during steps 5–6 require **resumable** copy (reuse staging content; lock still held → **409** for competing restores) or support playbook.

### 8.2b Abort restore cleanup (user-facing unlock)

Exposes **`POST /api/backup/restore/abort`** ([`../api_contract.md`](../api_contract.md) §6). Behaviour:

1. **`DeleteItem`** **`RESTORE_LOCK`** (**`SYSTEM#RESTORE_LOCK`**) on **primary** if present (**idempotent** if absent).
2. Paginated **`Query`** + **`BatchWriteItem`** deletes every item with **`PK = USER#<user_id>`** on the **restore staging** table (same partition-scoped pattern as §8.2 steps 2 and 7).

**Mandatory order:** **always step 1 then step 2.** Clearing **`RESTORE_LOCK`** first immediately lifts **`409`** on **`POST /api/backup/restore`**; staging partition deletes may take many **`BatchWriteItem`** rounds and must not block the user from seeing an unlocked state in UIs that poll for the flag. If staging cleanup fails after the lock is gone, **`POST /api/backup/restore/abort`** may return **`500`** with **`restore_lock_cleared`: **`true`** — client retries abort (**idempotent**); see [`../api_contract.md`](../api_contract.md) §6 **Partial failure**.

**Explicit non-goals (V1):** The abort endpoint **does not** invoke **`Lambda.Stop`** or any cancellation token — **no** guarantee that an invocation **currently executing** steps 5–6 stops immediately; callers assume restore **already failed**, timed out, or returned **500** while leaving **`RESTORE_LOCK`** (+ staging debris). Clearing staging **does not by itself repair** a primary partition already partially wiped mid-copy — ops escalation stays separate until async/recovery epics land.

---

### 8.3 Export mapping

Export is the inverse: query all user-scoped entities listed above from **primary**, strip **`PK`/`SK`/GSI** fields from the JSON wire encoding (or reconstruct ids-only shapes — restore reconstructs full keys), emit one JSON document per §8.1. **Exclude** **`RESTORE_LOCK`** items from export payloads.

---

### 8.4 Infrastructure

Provision **`aws_dynamodb_table`** for restore staging whose **name includes `restores_in_progress`** — canonical pattern **`${project_id}-${environment}-restores-in-progress`** — mirroring the primary table’s **attributes**, **`PK`/`SK`**, **GSI1**, **GSI2** (same Terraform patterns as [`infrastructure/main.tf`](../../../infrastructure/main.tf)). Lambda env e.g. **`DYNAMODB_RESTORE_STAGING_TABLE_NAME`**.

Lambda IAM: **`dynamodb:Query`**, **`BatchWriteItem`**, **`DeleteItem`**, **`PutItem`** on **both** primary and staging ARNs; restrict staging table access to restore paths only where practical.

## Related documentation

- [`../import_transaction_files.md`](../import_transaction_files.md) — import pipeline, cluster id lifecycle, splits/merges, write-back, and **§7.5** import file history (`TRANSACTION_FILE`).
- [`../api_contract.md`](../api_contract.md) — wire JSON and endpoints (`POST /api/imports`, `GET /api/transaction-files`, **`GET /api/backup/export`**, **`POST /api/backup/restore`**, **`POST /api/backup/restore/abort`** §6).
- [`../import_field_mapping.md`](../import_field_mapping.md) — from file fields to normalized import rows.
- [`../transaction_analysis_clusters_and_categories.md`](../transaction_analysis_clusters_and_categories.md) — merchant clustering and category behaviour; logical “optional extension” table should stay consistent with the **implemented** items above.
- [`../../02_architecture/02_data_flow.md`](../../02_architecture/02_data_flow.md) — ingestion, classification, and backup/restore snapshot flow.
- [`../../01_discovery/stage_1_understanding_mvp.md`](../../01_discovery/stage_1_understanding_mvp.md) — PRD backup / full-overwrite restore requirements.
- [`.agents/skills/db_admin/SKILL.md`](../../../.agents/skills/db_admin/SKILL.md) — who owns the `db/` package and co-maintaining this doc.
