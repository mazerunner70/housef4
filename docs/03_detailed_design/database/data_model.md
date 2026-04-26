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
| [`infrastructure/main.tf`](../../../infrastructure/main.tf) | `aws_dynamodb_table` definition (hash/range, GSI1). |
| `infrastructure/dynamodb_health_item.tf` | System row `PK=health-check`, `SK=BUILD` for health metadata (out of application domain). |

**Maintenance:** If you add attributes, a new GSI, or change key conventions, update **this file** in the same change as `db/`, `infrastructure/`, and any API updates to [`../api_contract.md`](../api_contract.md). The local PostgreSQL schema in `ml-training/schema.sql` is for notebooks only; keep it roughly aligned in spirit, but it is not the source of truth for production.

---

## Table: single-table design

- **Table name (Terraform):** `${project_id}-${environment}-table` (see `infrastructure/main.tf` outputs).
- **Billing:** `PAY_PER_REQUEST` (on-demand).
- **Base table keys**
  - **`PK`** (String) — partition key. User-scoped application rows use `USER#<user_id>`.
  - **`SK`** (String) — sort key. Distinguishes entity type and id: `TXN#<transaction_id>`, `CLUSTER#<cluster_id>`, `FILE#<file_id>`, or literal `PROFILE` for the user’s profile.
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
| **`entity_type`** | String | `TRANSACTION`, `CLUSTER`, `TRANSACTION_FILE`, or `PROFILE`. Used when reading and filtering. |

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
| **`source`** | Map (object) | **§1 — Multipart / upload audit:** `name` (client filename or display default), `size_bytes`, optional `content_type` (part MIME). |
| **`format`** | Map (object) | **§2 — Import source type for parsing** (set after sniffing): optional `source_format` (e.g. `csv` / `ofx` / `qfx` / `qif`); optional `currency` (ISO 4217) when inferrable (e.g. OFX `CURDEF`); may be empty if unknown. |
| **`timing`** | Map (object) | **§3 — Clock (epoch ms UTC):** `started_at` (after a successful multipart extract, before parse/enrich/ingest), `completed_at` (when the run finishes and the item is written). **Listing order** (newest first) uses `timing.completed_at`. |
| **`result`** | Map (object) | **§4 — Batch summary** — full **`ImportIngestResult`**: `rowCount`, `knownMerchants`, `unknownMerchants`, `existingTransactionsUpdated`, `newClustersTouched` (the last two include re-cluster patch effects where applicable; see [`db/src/types.ts`](../../../db/src/types.ts)). |

Does not use GSI1. Listed via base-table query: `PK = USER#<user_id>` and `SK` begins with `FILE#`.

**Legacy items (read path):** some rows may pre-date this layout and still store top-level `name` / `imported_at` / `row_count`, maps named **`file_import`** (source + optional `source_format` combined) and **`ingest`** (outcome), or loose `source_format` on the item. The repository **normalizes** these to the same **`TransactionFileRecord`** shape for `listTransactionFiles` and **`GET /api/transaction-files`**, using `imported_at` to populate `timing.completed_at` (and a conservative `started_at` when only completion time is known).

**Schema changes / existing data:** the project is **not** doing automated backfills for this entity in early phases. If attributes change or items are inconsistent, **delete the affected DynamoDB items (or the user’s prefix in non-prod) after explicit approval**; full migration tooling can wait until much later. Prefer removing stale `TRANSACTION_FILE` items over ad-hoc in-place rewrites.

---

## 4. Profile (`entity_type: PROFILE`)

One item per user for metrics that are **stored** (not only derived in memory). **Key:**

| Key | Value pattern |
|-----|----------------|
| `PK` | `USER#<user_id>` |
| `SK` | `PROFILE` (constant, see `PROFILE_SK` in `db/src/keys.ts`) |

**Attributes:** `net_worth` (Number) is written on create (`ensureProfile`); `getMetrics` reads it for the dashboard. Other cashflow and spending breakdowns are **computed** from transaction queries in the current implementation. Optional `default_currency` (String, ISO 4217) may be set for display; when absent, APIs default to `USD`.

---

## 5. Health system row (non-domain)

A Terraform-managed item supports build/version health checks. It is **not** a user or application entity. See `infrastructure/dynamodb_health_item.tf` (`PK=health-check`, `SK=BUILD`).

---

## Related documentation

- [`../import_transaction_files.md`](../import_transaction_files.md) — import pipeline, cluster id lifecycle, splits/merges, write-back, and **§7.5** import file history (`TRANSACTION_FILE`).
- [`../api_contract.md`](../api_contract.md) — wire JSON and endpoints (`POST /api/imports`, `GET /api/transaction-files`).
- [`../import_field_mapping.md`](../import_field_mapping.md) — from file fields to normalized import rows.
- [`../transaction_analysis_clusters_and_categories.md`](../transaction_analysis_clusters_and_categories.md) — merchant clustering and category behaviour; logical “optional extension” table should stay consistent with the **implemented** items above.
- [`../../02_architecture/02_data_flow.md`](../../02_architecture/02_data_flow.md) — ingestion and classification flow.
- [`.agents/skills/db_admin/SKILL.md`](../../../.agents/skills/db_admin/SKILL.md) — who owns the `db/` package and co-maintaining this doc.
