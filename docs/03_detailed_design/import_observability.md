# Import orchestration observability

Structured logs for **`POST /api/imports`** per-stage timing and outcomes. Implements [`import_transaction_files.md`](./import_transaction_files.md) §11.2 item **2** and §4.8 “per-stage observability.”

## Mechanism

**Structured JSON logs** via `backend/src/logger.ts` — one **`import.stages.summary`** line per request at **info**, plus per-stage **`import.stage`** at **debug** (success) or **warn** (failure).

**CloudWatch Metrics (Lambda / non-local only)** via **[EMF](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html)** using [`aws-embedded-metrics`](https://github.com/awslabs/aws-embedded-metrics-node) in `backend/src/observability/importMetrics.ts`. EMF writes a special JSON line to **stdout** (no AWS SDK or network at runtime); Lambda log ingestion creates metrics automatically. **`emitImportCloudWatchMetrics` is a no-op when `APP_ENV=local`** (see `backend/src/config.ts`).

Implementation: `backend/src/services/import/importStageTracing.ts` (logs + calls metrics on `emitSummary`).

## Log events

| `msg` | Level | When |
| --- | --- | --- |
| `import.stage` | `debug` | Stage completed successfully |
| `import.stage` | `warn` | Stage threw (before rethrow) |
| `import.stages.summary` | `info` | Import finished (success or failure after tracing started) |
| `import.complete` | `info` | Successful import only — business counters (unchanged) |
| EMF stdout (Lambda) | — | CloudWatch Metrics in namespace **`Housef4/Import`** (non-local only) |

## CloudWatch Metrics (EMF)

**Namespace:** `Housef4/Import`

| Metric | Unit | Dimensions | When |
| --- | --- | --- | --- |
| `ImportTotalDurationMs` | Milliseconds | `Outcome`, `Staging` | Every import (non-local) |
| `ImportCount` | Count | `Outcome`, `Staging` | Every import — use for error-rate alarms |
| `ImportRowCount` | Count | `Outcome`, `Staging` | When `rowCount` known |
| `ImportStageDurationMs` | Milliseconds | `Stage`, `Outcome`, `Staging` | Per §4.2 stage that ran (skipped stages omitted) |

**Properties (not metrics):** `FailedStage` on the summary EMF line when present — low-cardinality diagnostic only.

**Do not** add `userId` or `importFileId` as metric dimensions (cardinality). Keep those in **`import.stages.summary`** logs.

**Local dev:** `APP_ENV=local` (default when not running in Lambda) → EMF disabled; grep **`import.stages.summary`** in the terminal.

**Lambda (staging / production):** requires **`AWS_LAMBDA_FUNCTION_NAME`** (always set by the runtime). Optionally set `APP_ENV=staging` or `APP_ENV=production`; EMF is skipped when `APP_ENV=local` even if Lambda env vars are present.

## Correlation fields

| Field | Source | Notes |
| --- | --- | --- |
| `requestId` | `requestLogContext` | All import logs inherit Lambda `awsRequestId` or local UUID |
| `userId` | Authenticated user | Present on every import log |
| `importFileId` | Stage **5** mint | Set on tracer once allocated; omitted on early abort (e.g. duplicate blob) |
| `rowCount` | Parsed rows | Set after stage **3** |
| `staging` | Repository | `true` when §8.7 import staging promote path runs |

## Stage identifiers (`stage` / `stages` map keys)

Aligned with [`import_transaction_files.md` §4.2](./import_transaction_files.md):

| Key | §4.2 stage | Measured work |
| --- | --- | --- |
| `1` | Ingress | Multipart extract + validation |
| `2` | Resolve account | Pre-lock validation + post-lock create/resolve |
| `2b` | Duplicate blob guard | SHA-256 fingerprint + duplicate lookup |
| `3` | Parse | Format detect + row decode |
| `4` | Canonical amount policy | Negation hints + apply |
| `5` | Allocate batch artefact IDs | `import_file_id` + per-row txn ids |
| `6` | Load ledger snapshot | `listTransactions` + file→account map |
| `7` | Transfer pairing | Ingest-scoped pairing |
| `8` | Cluster & categorise | Embedder + DBSCAN + category rules |
| `9` | Build persist intents | `PersistPlan` assembly |
| `10` | Apply persist plan | Staging promote or in-place patch/ingest/retire |
| `11` | Record import file metadata | `recordTransactionFile` (in-place path only) |
| `12` | Derive aggregates | `refreshStoredDashboardMetrics` (in-place path only) |

Stages **6–9** are marked **`skipped`** (zero `durationMs`) when the upload parses to **zero data rows**. On the **staging** path, stages **11–12** run inside the repository promote subroutine and are not split out separately — stage **10** duration covers the full §8.7 commit.

## `import.stages.summary` shape

```json
{
  "level": "info",
  "msg": "import.stages.summary",
  "service": "housef4-api",
  "requestId": "…",
  "outcome": "ok",
  "totalDurationMs": 842,
  "userId": "…",
  "importFileId": "…",
  "rowCount": 42,
  "staging": false,
  "stages": {
    "1": { "durationMs": 3, "outcome": "ok" },
    "2": { "durationMs": 12, "outcome": "ok" },
    "2b": { "durationMs": 8, "outcome": "ok" },
    "3": { "durationMs": 5, "outcome": "ok" },
    "8": { "durationMs": 610, "outcome": "ok" }
  }
}
```

On failure, `outcome` is **`error`**, `failedStage` names the §4.2 key, and the failing stage entry has **`outcome: "error"`**.

## CloudWatch Logs Insights (examples)

**P95 stage-8 (cluster) duration (successful imports):**

```
fields @timestamp, stages.8.durationMs as clusterMs, importFileId, rowCount
| filter msg = "import.stages.summary" and outcome = "ok" and ispresent(stages.8)
| stats pct(clusterMs, 95) as p95ClusterMs, avg(clusterMs) as avgClusterMs by bin(1h)
```

**Failed imports by stage:**

```
fields @timestamp, failedStage, userId, importFileId
| filter msg = "import.stages.summary" and outcome = "error"
| stats count() by failedStage
```

**Duplicate blob rejections (stage 2b):**

```
fields @timestamp, userId, durationMs
| filter msg = "import.stage" and stage = "2b" and outcome = "error"
```

## CloudWatch Metrics console (EMF)

After a deploy, open **CloudWatch → Metrics → All metrics → Housef4/Import**:

- **`ImportStageDurationMs`** — graph with `Stage` dimension; watch stage **`8`** for clustering cost.
- **`ImportCount`** — sum by `Outcome` for error rate.
- **`ImportTotalDurationMs`** — p95 alarm on end-to-end import latency.

## Future

- **Dashboards / alarms in Terraform** when infra team wants checked-in widgets.
- **OpenTelemetry** / ADOT when distributed tracing is adopted repo-wide (`backend_dev_and_prod_environments.md` §11).

## Manual QA checklist

1. Run a local import (`pnpm dev` + SPA or curl multipart) and confirm one **`import.stages.summary`** line in API logs with `outcome: ok` and non-zero **`stages.3.durationMs`**.
2. Re-upload the **same file bytes**; confirm **`409 duplicate_blob`**, **`import.stages.summary`** with `outcome: error`, `failedStage: "2b"`, and **no** `importFileId`.
3. Zero-row CSV (header only): confirm **`stages.6`–`9`** entries with **`outcome: skipped`** (or absent if never touched — zero-row path marks them skipped explicitly).
4. With import staging enabled, confirm `staging: true` on summary and stage **10** present without separate **11**/**12** keys.
