---
title: Import raw file retention (local filesystem vs S3)
stage: Detailed Design
phase: Ingestion / persistence
related:
  - ./import_transaction_files.md
  - ./database/data_model.md
  - ./api_contract.md
  - ./backend_dev_and_prod_environments.md
  - ../02_architecture/03_infrastructure_map.md
status: Design proposal — not implemented
---

# Import raw file retention (local filesystem vs S3)

This document specifies how to **persist the uploaded file bytes** after a successful `POST /api/imports`, complementing today’s behaviour where only **metadata** and **parsed transactions** are stored (`TRANSACTION_FILE` + transaction items). It aligns with the production sketch in [`03_infrastructure_map.md`](../02_architecture/03_infrastructure_map.md) (**S3 raw upload archives**) and with environment wiring in [`backend_dev_and_prod_environments.md`](./backend_dev_and_prod_environments.md).

---

## 1. Goals

| Goal | Detail |
|------|--------|
| **Durability** | Operators and power users can **re-download** or **audit** the exact bytes that produced a batch (support, disputes, parser regressions). |
| **Parity** | The same **application code path** runs locally and in Lambda; only a **storage backend** implementation differs. |
| **Isolation** | Objects are **not** world-readable; keys are **user-scoped** so one user cannot access another’s blobs by guessing ids alone (see §6). |
| **Simplicity** | No new synchronous dependencies on Step Functions unless later requirements demand async archival; **inline PutObject / fs.writeFile** in the import handler is sufficient for MVP sizes (bank exports are typically small). |

Non-goals for the first slice: virus scanning pipelines, multipart upload to S3 for huge files, CDN exposure of raw exports, or automated GDPR “erase blob” workflows beyond documenting how keys tie to `user_id`.

---

## 2. Current vs proposed

| Today | Proposed |
|-------|----------|
| Buffer parsed in memory; **`TRANSACTION_FILE`** stores filename, size, MIME, format, timing, ingest stats only. | After multipart extract (same buffer used for `parseImportBuffer`), **write bytes** to configured backend **before or during** the same request lifecycle. |
| No blob URI on the Dynamo row. | Extend **`TRANSACTION_FILE`** (see §5) with a stable **`blob`** descriptor so APIs and ops know **where** the object lives without embedding secrets. |

---

## 3. Storage abstraction

Introduce a small **`ImportBlobStore`** (name indicative; place under `backend/src/services/import/` or shared `packages/` if reused) with one responsibility: **put** bytes for an import, **optional delete** on compensating failure.

```ts
// Conceptual interface — exact types live with implementation PR.
export type PutImportBlobInput = {
  userId: string;
  importFileId: string;
  accountId: string;
  /** Original client filename (for optional Content-Disposition metadata only). */
  originalName: string;
  contentType?: string;
  body: Buffer;
};

export type PutImportBlobResult = {
  /** Stable logical reference persisted on TRANSACTION_FILE (§5). */
  ref: ImportBlobRef;
};

/** Serialized shape stored on Dynamo — no presigned URLs or IAM secrets. */
export type ImportBlobRef = {
  kind: 'filesystem' | 's3';
  /** Relative key within the backend’s namespace, e.g. `userId/importFileId/original-sanitized.ext`. */
  key: string;
  /** Optional; set for S3 — bucket name or alias from env (not secret). */
  bucket?: string;
  /** SHA-256 hex of body at write time — integrity + dedupe debugging. */
  content_sha256: string;
  /** Same as source.size_bytes after write. */
  stored_bytes: number;
};
```

**Factories**

| `APP_ENV` / config | Implementation |
|-------------------|----------------|
| `local` (default for laptop) | **`FilesystemImportBlobStore`**: root directory from **`IMPORT_BLOB_LOCAL_ROOT`** (absolute path, e.g. `./var/housef4/import-blobs` — **gitignored**). |
| `production`, `staging` | **`S3ImportBlobStore`**: bucket from **`IMPORT_BLOB_S3_BUCKET`** (Terraform-managed); region follows **`AWS_REGION`**. |

Selection is **explicit env**: do not infer “Lambda ⇒ S3” alone, so integration tests can run S3Local or filesystem in CI deterministically.

---

## 4. Object layout and naming

### 4.1 Key structure (both backends)

Use a **deterministic** path so support can correlate Dynamo **`FILE#<importFileId>`** with storage without scanning:

```text
imports/<user_id>/<import_file_id>/<safe_original_filename>
```

- **`user_id`**: Cognito `sub` (same string as Dynamo `PK` user segment).
- **`import_file_id`**: Existing UUID generated at start of import (`importFileId` in API response).
- **`safe_original_filename`**: Basename only; replace `..`, slashes, and control chars; cap length (e.g. 120); fallback `upload.bin` if empty.

This avoids collisions across users and imports while keeping a human-readable leaf name.

### 4.2 Local filesystem

- **Root**: `IMPORT_BLOB_LOCAL_ROOT` must exist or be created lazily on startup (log once).
- **Permissions**: directory `0700` or OS-equivalent; files `0600`.
- **Volume**: document that Docker/dev mounts may map this path for persistence across container restarts.

### 4.3 S3

- **Bucket**: dedicated **`IMPORT_BLOB_S3_BUCKET`** (separate from frontend static bucket — already distinct in Terraform mental model).
- **SSE**: bucket default encryption **AES256** (match frontend bucket pattern in [`infrastructure/main.tf`](../../infrastructure/main.tf)).
- **Public access**: blocked; no bucket policy for anonymous read.
- **Optional lifecycle**: S3 lifecycle rule to transition to **Infrequent Access** after N days or expire after legal retention period — product decision; default **no expiry** for MVP.

---

## 5. DynamoDB: `TRANSACTION_FILE` extension

**Canonical documentation** after implementation: update [`database/data_model.md`](./database/data_model.md) §3 and **`TransactionFileInput`** / **`TransactionFileRecord`** in [`db/src/types.ts`](../../../db/src/types.ts).

Add an optional map **`blob`** (omit when storage is **`off`**, or after a failed blob write under the **V1 non-fatal policy** — §8):

| Attribute | Type | Notes |
|-----------|------|--------|
| `kind` | string | `filesystem` \| `s3` — mirrors `ImportBlobRef.kind`. |
| `key` | string | Full logical key under backend root / bucket (e.g. `imports/<user_id>/<import_file_id>/<file>`). |
| `bucket` | string (optional) | S3 bucket name when `kind === 's3'`. |
| `content_sha256` | string | Hex digest at ingest time. |
| `stored_bytes` | number | Must equal `source.size_bytes` after a successful blob write; mismatch → treat as blob write failure (§8 **non-fatal** policy). |

**Wire format**: extend **`GET /api/transaction-files`** and related TypeScript types so the SPA can show “archived” vs “metadata only” when **`blob`** is present. Optional later endpoint **`GET /api/transaction-files/:id/download`** returns **302** to a **short-lived presigned GET** (S3) or streams from disk (local) — not required for MVP retention slice.

---

## 6. Security and IAM

1. **Authorization**: Any download API must verify **`transaction_files[].id`** belongs to the authenticated **`user_id`** before issuing presigned URLs or reading disk paths.
2. **Path traversal**: `safe_original_filename` must never escape the segment `imports/<user_id>/<import_file_id>/`.
3. **Lambda IAM**: Grant **`s3:PutObject`**, **`s3:GetObject`** (if serving downloads), **`s3:DeleteObject`** (if compensating deletes) only on **`arn:aws:s3:::IMPORT_BLOB_S3_BUCKET/imports/*`** for this dedicated bucket.
4. **Secrets**: Presigned URLs are generated on demand; **never** store access keys or presigned URLs on Dynamo items.

---

## 7. Import handler sequencing

Recommended order to minimise orphaned blobs:

```mermaid
sequenceDiagram
  participant API as POST /api/imports
  participant Parse as parseImportBuffer + ingest
  participant Blob as ImportBlobStore
  participant DDB as DynamoDB

  API->>API: extract multipart → Buffer + metadata
  API->>API: importFileId := uuid()
  Note over API: Account resolve (new / existing)
  API->>Parse: parse + enrich + ingestImportBatch
  Parse-->>API: ingest result
  alt feature enabled && ingest succeeded (policy)
    API->>Blob: put(body, importFileId, userId, …)
    alt blob Put succeeds
      Blob-->>API: ImportBlobRef
      API->>DDB: recordTransactionFile(..., blob: ref)
    else blob Put fails — V1 non-fatal (§8)
      Blob-->>API: error
      API->>DDB: recordTransactionFile(..., omit blob)
      Note right of API: Still HTTP 200 + ImportParseResult; log + metric import.blob_write_failed
    end
  else feature disabled or ingest aborted before record
    Note over Blob,DDB: No blob write; recordTransactionFile without blob when ingest completes
  end
```

**Alternative** (write blob **before** parse): improves “bytes always retained even if parse crashes,” but duplicates storage when clients retry the same file with fixes — acceptable if product wants forensic completeness. Default recommendation: **write after successful ingest** so garbage uploads do not fill storage; document product trade-off explicitly.

**Idempotency**: Re-posting the same file creates a **new** `importFileId` and **new** object key — correct for append semantics.

---

## 8. Failure modes

**V1 deterministic policy — blob `Put` failure after successful ingest is non-fatal:** Transaction data and dashboard correctness take precedence over archival. If **`parseImportBatch`** / ingest and **`recordTransactionFile`** would otherwise succeed, a blob **`Put`** failure **must not** change **`POST /api/imports`** to **`5xx`**. Instead:

1. **`recordTransactionFile`** with **metadata only** (omit **`blob`** on the **`TRANSACTION_FILE`** item).
2. Return **`200 OK`** with the normal **`ImportParseResult`** body ([`api_contract.md`](./api_contract.md) §1).
3. Emit structured log + metric **`import.blob_write_failed`** (include `importFileId`, `user_id`, storage backend, error class).

Clients infer archival only from **`GET /api/transaction-files`** — presence of **`blob`** on that row — not from import **`200`** alone.

| Scenario | Behaviour |
|----------|-----------|
| Blob **`Put`** fails after ingest succeeded | **Non-fatal (V1 — mandatory):** **`200`** + **`TRANSACTION_FILE` without `blob`**; log + **`import.blob_write_failed`** — see bullets above. **Do not** return **`5xx`** solely for blob failure (includes throttle, **`AccessDenied`**, disk full during **`Put`**) when the metadata-only **`recordTransactionFile`** succeeds. |
| Dynamo **`recordTransactionFile`** fails after blob **`Put`** | **Delete** object with same key (compensating `DeleteObject` / `unlink`); retry Dynamo once; **`5xx`** if the **`TRANSACTION_FILE`** row cannot be persisted. |

Detect incomplete **`Put`** (e.g. compare written bytes to buffer length); failed **`Put`** follows the **non-fatal** row above, not a silent partial object.

---

## 9. Configuration summary

| Variable | Where | Purpose |
|----------|-------|---------|
| `IMPORT_BLOB_BACKEND` | Lambda + local | `filesystem` \| `s3` \| `off` (legacy behaviour). |
| `IMPORT_BLOB_LOCAL_ROOT` | Local | Absolute directory root for nested `imports/...`. |
| `IMPORT_BLOB_S3_BUCKET` | Prod/staging Lambda | Target bucket name. |

Terraform: create **`aws_s3_bucket.import_blob_archive`** (or reuse name from infra map), encryption, public access block, lifecycle optional; output bucket name into Lambda env.

---

## 10. Testing strategy

- **Unit**: mock `ImportBlobStore`; assert handler calls put with expected key and passes `blob` into `recordTransactionFile` on success; assert **`Put`** failure yields **`recordTransactionFile`** **without** `blob` and **`200`** response (**non-fatal** §8).
- **Integration (local)**: temp directory store + DynamoDB Local; full `POST /api/imports` round-trip; assert file exists on disk and Dynamo contains `blob.content_sha256`.
- **Integration (AWS optional)**: ephemeral bucket or prefix in dev account with teardown.

---

## 11. Documentation and implementation checklist

When implementing, update in the **same change set**:

1. [`database/data_model.md`](./database/data_model.md) — `TRANSACTION_FILE` **`blob`** map.
2. [`api_contract.md`](./api_contract.md) — `transaction_files[]` shape if exposed to clients.
3. [`backend_dev_and_prod_environments.md`](./backend_dev_and_prod_environments.md) — §5 env table rows for blob vars.
4. [`02_data_flow.md`](../02_architecture/02_data_flow.md) — note object store step after parse/ingest.
5. [`import_transaction_files.md`](./import_transaction_files.md) — cross-link from persistence / pipeline overview.

---

## 12. Related documents

- [`import_transaction_files.md`](./import_transaction_files.md) — cluster lifecycle and ingest writes.
- [`database/data_model.md`](./database/data_model.md) — `TRANSACTION_FILE` keys and attributes.
- [`api_contract.md`](./api_contract.md) — `POST /api/imports`, `GET /api/transaction-files`.
- [`backend_dev_and_prod_environments.md`](./backend_dev_and_prod_environments.md) — local vs Lambda configuration.
