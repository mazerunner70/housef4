# API Contract V1

This document establishes the JSON payload bounds for the MVP based on the agreed ML & Personal Finance requirements. The **`frontend/`** client implements these shapes in `src/api/client.ts` and `src/lib/types.ts`.

## Frontend client behavior

- **Base path**: requests use relative URLs under **`/api/...`**. In local Vite dev, `vite.config.ts` proxies `/api` to the backend (default target `http://localhost:3000`).
- **No client-side fixtures**: the SPA always calls the backend over HTTP; there is no in-browser mock dataset or simulated import parser in the frontend.
- **JSON field names**: snake_case is used for metrics and tag-rule responses; camelCase for the import summary. Match the examples below exactly.

## Date and time (JSON)

All date and datetime fields in JSON request and response bodies are **numbers: milliseconds since the Unix epoch (UTC)**. Do not use ISO-8601 strings on the wire—this keeps parsing unambiguous and avoids timezone string confusion.

## 1. Import Endpoint

Accepts a bank or PFM export file, parses it server-side into normalized transactions, persists them, and returns a summary aligned with the import UI (`ImportParseResult`). Supported uploads include **CSV**, **OFX**, **QFX** (OFX variant), and **QIF**; the server detects format from filename and/or `Content-Type`. How raw file fields map into the app’s canonical transaction fields is specified in [`import_field_mapping.md`](./import_field_mapping.md).

**`POST /api/imports`**

### Request

- **`multipart/form-data`** with a single part **`file`** (the export binary or text).
- Typical extensions: `.csv`, `.ofx`, `.qfx`, `.qif`. Relevant MIME types include `text/csv`, `application/x-ofx`, `application/vnd.intu.qfx`, `application/qif`, and `text/plain` when appropriate.

### Response Payload

```json
{
  "rowCount": 340,
  "knownMerchants": 290,
  "unknownMerchants": 50,
  "sourceFormat": "ofx"
}
```

| Field | Type | Notes |
|--------|------|--------|
| `rowCount` | number | Transaction rows successfully parsed and ingested. |
| `knownMerchants` | number | Rows matched to existing clusters or high-confidence categories. |
| `unknownMerchants` | number | Rows requiring cluster review (feeds review queue). |
| `sourceFormat` | string (optional) | One of: `csv`, `ofx`, `qfx`, `qif`. Omitted if the server cannot determine the format. |

After a successful import, subsequent **`GET /api/metrics`**, **`GET /api/transactions`**, and **`GET /api/review-queue`** responses must reflect the new data.

## 2. Metrics Baseline Endpoint

Provides the aggregated mathematical baseline for the dashboard.

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
| `net_worth_change_pct` | number | Fractional change (e.g. `0.041` → +4.1% in UI). |
| `liquid_assets` | number | For extended net-worth breakdowns. |
| `liabilities` | number | For extended net-worth breakdowns. |
| `cashflow_period_label` | string | Subtitle for the cash-flow chart (e.g. date range). |
| `cashflow_history` | array | `{ "label": string, "income": number, "expenses": number }[]` for multi-month chart. |
| `spending_by_category[].budget` | number (optional) | When set on a row, category pacing UI can show spent vs budget. |

## 3. Transactions Endpoint

Provides the raw and mapped list of transactions.

**`GET /api/transactions`**

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
      "is_recurring": true
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
      "is_recurring": false
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

Other fields follow the same snake_case names as in the example payload (`raw_merchant`, `cluster_id`, `category`, `is_recurring`).

## 4. Review Queue Endpoint

Fetches only clusters needing manual user mapping (Active Learning).

**`GET /api/review-queue`**

### Response Payload

```json
{
  "pending_clusters": [
    {
      "cluster_id": "CL_005",
      "sample_merchants": ["SQ * LOCAL COFFEE", "LOCAL COFFE PT"],
      "total_transactions": 14,
      "total_amount": 63.00,
      "suggested_category": null
    }
  ]
}
```

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
