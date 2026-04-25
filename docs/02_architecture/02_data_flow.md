---
title: Data Flow Diagram (Ingestion & Classification)
stage: Architecture
phase: High-Level Architecture
---

# Data Flow: Ingestion & Active Learning

This diagram illustrates the core MVP workflow: how a user uploads data, how the system parses it and attempts automated mapping, and how the review queue supports active learning. **HTTP paths, methods, and JSON field names follow [`docs/03_detailed_design/api_contract.md`](../03_detailed_design/api_contract.md)** (dates in JSON are **epoch milliseconds UTC**, not ISO strings). **DynamoDB keys, entity types, and GSI1** for what gets stored are defined in [`docs/03_detailed_design/database/data_model.md`](../03_detailed_design/database/data_model.md). **Import and cluster-identity** behaviour (re-cluster, carry/split/merge, write-back) is in [`docs/03_detailed_design/import_transaction_files.md`](../03_detailed_design/import_transaction_files.md).

The off-line ML environment (per transaction-analysis design) stays out of the hot request path to avoid expensive cloud iteration loops.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Web Frontend
    participant API as Lambda API Backend
    participant DB as DynamoDB (Single Table)
    participant LocalML as Local ML (Jupyter)

    Note over User, DB: 1. Data Ingestion
    User->>UI: Uploads bank export (CSV / OFX / QFX / QIF)
    UI->>API: POST /api/imports (multipart field file, Authorization JWT)
    API->>API: Resolve user from JWT (e.g. Cognito sub) Parse & normalize rows
    Note right of API: No default user; unauthenticated requests are rejected.

    Note over API, DB: 2. Categorization & persistence
    API->>DB: Query user's clusters / rules as needed
    alt Known / confident match
        API->>DB: Put txn (status CLASSIFIED, category set)
    else Ambiguous / new merchant
        API->>DB: Put txn (status PENDING_REVIEW)
        API->>DB: Upsert cluster; surface in review queue
    end
    API->>DB: Put TRANSACTION_FILE (source, format, timing, result)
    API-->>UI: ImportParseResult (rowCount, knownMerchants, importFileId?, transactionIds?, sourceFormat?)

    Note over UI, API: 3. Dashboard & lists (reflect new data)
    UI->>API: GET /api/metrics
    API-->>UI: Metrics payload (monthly_cashflow, net_worth, spending_by_category)
    UI->>API: GET /api/transactions
    API-->>UI: transactions[] (date as epoch ms, status CLASSIFIED | PENDING_REVIEW)
    UI->>API: GET /api/transaction-files
    API-->>UI: transaction_files[] (per-upload history, newest first)

    Note over User, API: 4. Active Learning (review queue)
    UI->>API: GET /api/review-queue
    API-->>UI: pending_clusters[]
    User->>UI: Assign category to cluster
    UI->>API: POST /api/rules/tag (cluster_id, assigned_category)
    API->>DB: Persist rule; update matching txns in cluster
    API-->>UI: TagRuleResponse (success, updated_transactions)

    Note over DB, LocalML: 5. Offline ML (non-MVP runtime)
    LocalML->>DB: Sync raw text data locally
    LocalML->>LocalML: Tune TF-IDF / DBSCAN (example)
    LocalML->>DB: Upload improved heuristics / rules
```
