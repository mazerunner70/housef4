# ADR 001: Type naming conventions (`db`, `backend`, `money`)

**Status:** Accepted  
**Date:** 2026-05-31  
**Scope:** `@housef4/db`, `@housef4/backend`, `@housef4/money` (frontend follows API wire shapes; not covered here)

## Context

Housef4 spans several layers—DynamoDB items, repository domain records, import pipelines, HTTP/backup wire JSON, and a shared money library. Type names and field casing have grown organically (`TransactionRecord` vs `ImportTransactionInput`, `camelCase` plans vs `snake_case` persisted rows, `ImportBlobStore` service vs data shapes).

Without a shared vocabulary:

- It is unclear whether a type is safe to expose on an API, pass to Dynamo, or use only inside a pipeline stage.
- “Store” collides with **service** interfaces (`ImportBlobStore`) and **persisted** shapes.
- Mappers (`transactionItemToRecord`, `storedAmountFieldsToWireMajor`) are the real boundary; suffixes should make that obvious.

This ADR defines **suffix = role at a boundary**. It codifies patterns already used in `db/src/types.ts` and import orchestration, and assigns ownership per package.

## Decision

### 1. Layer model

Types are named by **what boundary they belong to**, not by TypeScript keyword (`interface` vs `type`).

```text
HTTP / backup JSON (Wire)
        ↕ parse · serialize
Domain records (Record)          ← canonical in @housef4/db
        ↕ materialize · normalize
Dynamo rows (Item)               ← usually private; mappers in db/
        ↕
Import / handler pipelines (Input · Patch · Plan · Result · Snapshot)
        ↕
Value types (Money · Currency)   ← @housef4/money only
```

**Do not** use `*Store` for data shapes. Reserve **Store** for **behaviour** (interfaces with methods: put/get/delete), e.g. `ImportBlobStore`.

### 2. Suffix vocabulary (cross-package)

| Suffix | Meaning | Typical package | Exported? |
|--------|---------|-----------------|-----------|
| **`Record`** | Logical entity the app reads/writes through the repository; normalized across legacy layouts | `db` | Yes |
| **`Input`** | Create/replace intent before persistence | `db`, `backend` | Yes when crossing packages |
| **`Patch`** | Partial update to an existing `Record` (+ id) | `db`, `backend` | Yes when crossing packages |
| **`Plan`** | Derived work list before side effects | `db`, `backend` | Yes at orchestration boundaries |
| **`Result`** / **`Counts`** | Operation outcome or tallies (not stored entities) | `db`, `backend` | Yes |
| **`Snapshot`** | Read-once or point-in-time aggregate over many records | `backend` (planning), `db` (metrics) | Yes |
| **`Wire`** | External JSON/CSV/backup field set (major units, contract-driven) | `db` mappers; shapes in `api_contract.md` | Prefer functions over types unless stable |
| **`Item`** | Dynamo attribute bag (`PK`, `SK`, `entity_type`, …) | `db` only | **No** — use mappers, not public types |
| **`Stored`** | Persisted field subset when it **differs** from domain `Record` | `money`, `db`, `backend` | Sparingly |
| **`Ref`** | Pointer to external blob/object storage | `db` | Yes |
| **`Status`** / **`Kind`** / closed unions | Enum-like string unions | any | Yes |
| **`Options`** / **`Params`** / **`Context`** | Config or call-site bag for one function/module | `backend` | Module-local unless reused |
| **`Payload`** | Handler HTTP body/response envelope | `backend` handlers | Yes at HTTP edge |

Version suffixes (**`V1`**, **`V2`**) apply only to **wire/evolving schemas** (e.g. `BackupSnapshotV1`, `BACKUP_SCHEMA_VERSION_V1`), not to domain `Record` types.

### 3. Prefix rules

1. **`{Entity}{Role}`** — entity noun first, role suffix last: `TransactionRecord`, `AccountRecord`.
2. **Nested sections** — **`{Parent}{Section}`**: `TransactionFileSource`, `TransactionFileFormat`, `TransactionFileTiming`.
3. **Pipeline-scoped** — prefix with stage when not a CRUD entity: `ImportPersistPlan`, `ImportIngestResult`, `LedgerSnapshot`.
4. **Pairing** — prefer symmetric pairs where practical:
   - `TransactionFileInput` → persisted as `TransactionFileRecord` (`Input & { user_id }`).
   - `ImportTransactionInput` + `ExistingTransactionPatch` → `TransactionRecord` (legacy naming; see §6).

### 4. Field naming (casing)

Casing follows **boundary**, not package:

| Boundary | Casing | Examples |
|----------|--------|----------|
| Persisted rows, API-aligned `*Record`, backup slots documented in `data_model.md` / `api_contract.md` | **`snake_case`** | `user_id`, `amount_minor`, `transaction_file_id` |
| In-process pipeline types (`*Plan`, `*Result`, `*Hint`, backend `*Params`) | **`camelCase`** | `toInsert`, `existingPatches`, `previousCategoryId` |
| Dynamo `*Item` mappers (internal) | Match **stored attribute names** (today `snake_case`) | `amount_minor`, `entity_type` |

Do not mix casings within a single type. When a `db` type crosses into `backend`, keep its established casing; do not rename fields at the import boundary without a dedicated migration.

### 5. Mapper function naming

Mappers live next to the layer they bridge. Use explicit direction:

| Pattern | Direction | Example |
|---------|-----------|---------|
| `{entity}ItemToRecord` | Dynamo → domain | `transactionItemToRecord` |
| `{entity}RecordToBackupWire` | domain → backup JSON | `transactionRecordToBackupWire` |
| `importTransactionToDynamoItem` | domain/input → Dynamo | `importTransactionToDynamoItem` |
| `materializeImportPlanToItems` | plan → many items | `materializeImportPlanToItems` |
| `readStoredAmount` / `writeStoredAmountFields` | row ↔ stored `*_minor` | `@housef4/money` |
| `storedAmountFieldsToWireMajor` | stored `*_minor` → API major | `@housef4/money` |
| `applyStoredAmountToRecord` | row fragment → `Record` | `db/storedAmount.ts` |

Avoid vague names (`mapTransaction`, `convert`) without direction and target shape.

---

## Package ownership

### `@housef4/db` (`db/src/types.ts` and repository)

**Canonical home for domain entity shapes** consumed by backend and tests.

Export:

- **`*Record`** — `TransactionRecord`, `AccountRecord`, `TransactionFileRecord`, lock records, etc.
- **`*Input`**, **`*Patch`**, **`*Plan`**, **`*Result`**, **`*Ref`**, **`*Snapshot`** when they define repository or backup contracts.
- **`TransactionStatus`** and similar closed unions.

Keep private (functions only, no exported `*Item` types):

- Dynamo serialization layout and legacy alias handling (`parseSourceFromItem`, `transactionFileRecordFromItem`, …).

**`TransactionFileRecord`** is the established pattern for “input + `user_id`”:

```typescript
export type TransactionFileRecord = TransactionFileInput & { user_id: string };
```

Use the same idiom when adding new persisted entities unless `Record` is materially wider than `Input`.

Related docs: [`database/data_model.md`](../../03_detailed_design/database/data_model.md), [`api_contract.md`](../../03_detailed_design/api_contract.md).

### `@housef4/backend`

Backend types fall into three buckets:

1. **Re-export or import from `@housef4/db`** for anything that is stored or returned by the repository. Do not duplicate `*Record` definitions in backend.
2. **Pipeline / stage types** (import clustering, planning, pairing) — **`camelCase`**, suffix **`Params`**, **`Options`**, **`Context`**, **`Result`**, **`Snapshot`**, **`Plan`**:
   - `LedgerSnapshot`, `PersistPlan`, `BuildPersistPlanParams`, `ClusterPipelineResult`, `ImportStageTracer`.
3. **HTTP edge** — **`Payload`** for handler bodies/responses not identical to a `Record`:
   - `HealthPayload`, `HealthDiagnosticPayload`.

**Services** (not data shapes): `*Store`, `*Repository`, `*Embedder`, `*Tracer` — interfaces describing behaviour.

Import blob storage:

- `ImportBlobStore` — service interface (`backend/.../importBlobTypes.ts`).
- `ImportBlobRef` — data pointer (`db/src/types.ts`).

Backend must not define parallel domain records for transactions, accounts, or import files.

### `@housef4/money`

Shared **value types** and **amount boundary** helpers only—no entity records.

| Name | Role |
|------|------|
| **`Currency`** | Branded ISO 4217 string |
| **`Money`** | Signed integer minor units (`{ units: number }`) |
| **`StoredAmountFields`** | Dynamo/backup **write/read** field subset (`amount_minor`, optional `file_amount_minor`) |
| **`ReadAmountResult`** | `StoredAmountFields` + optional legacy `amount_scale` |
| **`SupportedCreateAccountCurrency`** | Closed union for UI/account creation |

Functions encode wire vs storage explicitly:

- **`readStoredAmount`** / **`writeStoredAmountFields`** — row ↔ stored `*_minor` attributes (`Money` at call sites).
- **`storedAmountFieldsToWireMajor`** — stored `*_minor` → API/backup **major** decimals.
- **`fromMajor`** / **`toMajor`** — `Money` ↔ display/ingress major units.

Do not add `*Record` types to `money/`. Entity shapes stay in `db/`; money supplies fields and conversions.

Related doc: [`money_representation.md`](../../03_detailed_design/money_representation.md).

---

## When to introduce a new type vs a mapper only

| Situation | Action |
|-----------|--------|
| Read path normalizes legacy Dynamo layout | One **`Record`**; legacy only in `*FromItem` |
| Write shape ⊂ read shape | **`Input`** or **`Patch`**, not a second `Record` |
| Stored shape ⊃ domain (e.g. denormalized `currency` on item) | Omit from `Record`; handle in mapper or optional **`*Stored`** |
| API uses major units, domain uses `Money` | **`Record`** holds `*Amount: Money`; wire via `storedAmountFieldsToWireMajor` / `*ToWireMajor` at handler; Dynamo stores `*_minor` |
| Aggregate built from many records | **`Snapshot`** or **`View`**, not `*Record` |
| Unstable internal stage | Module-local type; export only if used across files |

---

## Consequences

### Positive

- New types have an obvious layer and export location.
- **`Record`** in `db` remains the single source of truth for entities.
- **`Store`** unambiguously means a service, not a DTO.
- Money conversions stay centralized in `@housef4/money`.

### Negative / trade-offs

- Two casings (`snake_case` vs `camelCase`) persist by design; pipeline types will not be mass-renamed to match API records.
- Some existing names predate this ADR and remain valid but non-ideal (see below).

### Compliance

- **New** exported types in `db`, `backend`, and `money` should follow this ADR.
- **Renames** only when touching the area for other reasons, or via an explicit cleanup pass with test coverage.

---

## Known legacy inconsistencies (non-blocking)

These are documented for alignment; no big-bang rename is required.

| Current | Ideal per ADR | Notes |
|---------|---------------|-------|
| `ImportTransactionInput` | `TransactionInput` | Breaks symmetry with `TransactionFileInput` / `TransactionFileRecord` |
| `ClusterAggregateHint.previousCategoryId` | `previous_category_id` **or** keep camelCase in backend-only hint | Mixed casing at `db` boundary |
| `ImportPersistPlan` in `db` vs `PersistPlan` in backend | Single name at package boundary | Two names for related artefact |
| `MetricsSnapshot` vs loose `BackupSnapshotV1` slots | Both valid; different strictness | Snapshot = aggregate vs versioned envelope |
| `ReplayRowStored` in backend | Acceptable `*Stored` for replay diff tooling | Intentional persisted-vs-replayed compare |

---

## References

- [`db/src/types.ts`](../../../db/src/types.ts) — domain and repository contract types
- [`money/src/index.ts`](../../../money/src/index.ts) — value types and amount mappers
- [`backend/src/services/import/planning/`](../../../backend/src/services/import/planning/) — pipeline snapshots and plans
- [`docs/03_detailed_design/money_representation.md`](../../03_detailed_design/money_representation.md)
- [`docs/03_detailed_design/database/data_model.md`](../../03_detailed_design/database/data_model.md)
- [`docs/03_detailed_design/api_contract.md`](../../03_detailed_design/api_contract.md)
- [`AGENTS.md`](../../../AGENTS.md) — monorepo layout and doc contracts
