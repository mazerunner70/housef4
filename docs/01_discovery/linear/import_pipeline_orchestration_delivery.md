# Linear delivery plan: import pipeline orchestration & cluster identity

## Purpose

This document translates [`docs/03_detailed_design/import_transaction_files.md`](../03_detailed_design/import_transaction_files.md) into a **sequenced backlog** suitable for Linear, with emphasis on **small, reviewable changes**. The authoritative behaviour spec remains that design doc (stages §4.2, cluster rules §6–§8, duplicate blob §11.2.1, pairing in [`transfer_matching.md`](../03_detailed_design/transfer_matching.md)).

## Linear workspace (synced)

- **Team:** House f3 (key **HOU**).
- **Project:** [Import orchestration & cluster_id delivery](https://linear.app/house-f4/project/import-orchestration-and-cluster-id-delivery-aea6406309e8) — started, High priority.

### Workspace labels created for this initiative

| Label | Role |
| --- | --- |
| **import-parity** | Parity/move-only refactor slice; reviewers expect no intentional behaviour drift. |
| **import-semantics** | Behaviour change: clustering, aggregates, dedupe/conflict semantics, SPA churn. |
| **contracts** | Touches **`api_contract.md`** and/or **`database/data_model.md`**. |
| **import-follow-on** | Deferred verticals (blobs, restore lock, SQS, pairing entrypoint). |
| **import-frontend** | SPA / import UX in this initiative. |

*(Existing workspace labels **Feature**, **Improvement**, **Bug** remain available for breadth.)*

### Issues (identifiers & links)

Sequential chain (**blockedBy**) for minimal conflict: **HOU-34 → 35 → 36 → 37 → 38** → then **39 → 40**. After **38**, **HOU-41–43** parallel; **HOU-44** after **39**. Follow-ons (**HOU-45–48**) blocked by **38**.

| Issue | Title | Depends on |
| --- | --- | --- |
| [HOU-34](https://linear.app/house-f4/issue/HOU-34/scaffold-import-orchestration-module-with-documented-stage-pipeline) | Scaffold import orchestration module with documented stage pipeline | — |
| [HOU-35](https://linear.app/house-f4/issue/HOU-35/extract-ledgersnapshot-builder-single-read-pass) | Extract LedgerSnapshot builder (single read pass) | HOU-34 |
| [HOU-36](https://linear.app/house-f4/issue/HOU-36/introduce-persistplan-shape-and-persistimportplan-subroutine) | Introduce PersistPlan shape and persistImportPlan subroutine | HOU-35 |
| [HOU-37](https://linear.app/house-f4/issue/HOU-37/unify-id-minting-stage-after-parse-import-file-id-per-row-txn-ids) | Unify ID minting stage after parse | HOU-36 |
| [HOU-38](https://linear.app/house-f4/issue/HOU-38/refactor-enrichplanning-into-runimportplanning-stages-79) | Refactor enrich/planning into runImportPlanning | HOU-37 |
| [HOU-39](https://linear.app/house-f4/issue/HOU-39/corpus-re-cluster-remint-transactional-cluster_id-per-physical-group) | Corpus re-cluster: remint transactional cluster_id per physical group | HOU-38 |
| [HOU-40](https://linear.app/house-f4/issue/HOU-40/cluster-aggregates-previous-category-id-and-review-predicate) | CLUSTER aggregates: previous_category_id and review predicate | HOU-39 |
| [HOU-41](https://linear.app/house-f4/issue/HOU-41/duplicate-upload-guard-sha-256-fingerprint-and-409-conflict) | Duplicate upload guard: SHA-256 fingerprint and 409 Conflict | HOU-38 |
| [HOU-42](https://linear.app/house-f4/issue/HOU-42/block-overlapping-imports-per-user-single-flight) | Block overlapping imports per user (single-flight) | HOU-38 |
| [HOU-43](https://linear.app/house-f4/issue/HOU-43/per-stage-tracingmetrics-for-import-orchestration) | Per-stage tracing/metrics | HOU-38 |
| [HOU-44](https://linear.app/house-f4/issue/HOU-44/frontend-import-startend-cluster-id-churn-ux-refetch) | Frontend: cluster_id churn UX + refetch | HOU-39 |
| [HOU-45](https://linear.app/house-f4/issue/HOU-45/follow-on-persist-raw-import-blobs-orphan-policy-on-persist-failure) | (Follow-on) Persist raw import blobs | HOU-38 |
| [HOU-46](https://linear.app/house-f4/issue/HOU-46/follow-on-block-imports-during-backup-restore-lock) | (Follow-on) Block imports during restore lock | HOU-38 |
| [HOU-47](https://linear.app/house-f4/issue/HOU-47/follow-on-sqsworker-planning-when-import-corpus-exceeds-thresholds) | (Follow-on) SQS/worker planning | HOU-38 |
| [HOU-48](https://linear.app/house-f4/issue/HOU-48/follow-on-non-import-entrypoint-reconcile-from-pairing-stage) | (Follow-on) Non-import pairing entrypoint | HOU-38 |

## Review strategy (default for every story below)

Ship work as **narrow vertical or horizontal slices**, not monolith PRs:

- **Separate mechanical extraction from behavioural change.** A PR that only moves existing logic into named functions/modules is dramatically easier to review than one that also changes clustering semantics.
- **Prefer dependency order:** higher-level orchestration scaffolding can land first if it **preserves parity** (same Dynamo effects and HTTP responses); semantic changes land in **focused follow-ups** with targeted tests.
- **Cap cognitive load:** If a story touches **backend + `db/` + docs**, keep the diff cohesive (one workflow), but split **contracts** (`api_contract.md`, `database/data_model.md`) into the **same PR** as the code that honours them—not a paperwork-only mega-PR trailing the implementation.
- **Tests:** parity or golden-path tests for refactors; explicit cases for **remint**, **409 duplicate blob**, pairing exclusion, and `CLUSTER#…` aggregate fields when behaviour changes.

## Interpretation of “top down” sequencing

Build **from the ingress boundary inward**, introducing **explicit stage boundaries** early so later stories slot into stable seams:

1. **Orchestration shell** documents order of operations (even if internals still call legacy blobs).  
2. **Read-only planning inputs** (`LedgerSnapshot`, duplicate fingerprint **read path**) stabilize data threading.  
3. **Planning output** (`PersistPlan`) and **`persistImportPlan`** make persistence **one audited subroutine**.  
4. **Semantic work** inside stage 8 (corpus **`cluster_id` remint**, §7 category / review hints) lands when types and ordering are settled.  
5. **Cross-cutting** concerns (duplicate **409**, `content_sha256` persistence, concurrency, observability, UI invalidate) attach to the seam they belong to—not bundled with unrelated refactors.

## Suggested backlog (Linear issues)

Use one **parent epic issue** (“Import orchestration & cluster identity”) optional; otherwise a **fixed-order milestone** with dependencies. Titles below are Linear-ready.

| Order | Issue title | Intent | Typical PR scope |
| ---: | --- | --- | --- |
| **1** | Scaffold import orchestration module with documented stage pipeline | Thin `imports` handler delegates to `backend/src/services/import/` orchestration entry; numbered stages mirrored to [`import_transaction_files.md` §4.2](../03_detailed_design/import_transaction_files.md); **parity**—no deliberate behaviour drift. | `backend/` move-only + doc pointer in orchestration comments |
| **2** | Extract LedgerSnapshot builder (single read pass) | `listTransactions` + file→account mapping built **once**, passed into pairing/cluster/plan builders; eliminates repeated full-table reads (`§4.4`). | `backend/src/services/import/` new module + call-site wiring |
| **3** | Introduce PersistPlan shape and persistImportPlan subroutine | Types for `to_insert`, `existing_patches`, `retired_cluster_ids` (exact names aligned with repo); Dynamo write order **`patchExisting` → `ingestImportBatch` → `retireClusterAggregates`** isolated (`§8.1`, §4.2 stage 10). | `backend/` + minimal `db/` only if signatures need widening |
| **4** | Unify ID minting stage after parse (`import_file_id`, per-row txn ids) | Co-locate allocation per design §4.2 stage 5 / §4.5 item 3; preserve index alignment guarantees (`ParsedRow[i]` ↔ `transaction_id[i]`). | `backend/` focused diff in import path |
| **5** | Refactor enrich/planning into runImportPlanning (stages 7–9) | Replace or thin `enrichImportRows`; wire **pairing** (`backend/src/services/pairing/`), cluster pipeline, persist-intent assembly into one **planning** function returning `PersistPlan` (`§4.3`). | `backend/` pipeline modules; **`no** clustering identity semantic change unless already matching spec |
| **6** | Corpus re-cluster: remint transactional `cluster_id` per physical group | Implement **`§6.0`** (always mint per embedding group incl. singletons/noise); ensure GSI1 and transaction writes stay consistent; retirement list populated (`§8.4`). **Dedicated PR**—largest behavioural risk. | `backend/` cluster pipeline + `db/` helpers + **`database/data_model.md`** if attributes clarified |
| **7** | CLUSTER aggregates: previous_category_id and review predicate | Implement **`§7`** (`previous_category_id` on `CLUSTER#…`, `pending_review` / review-queue inclusion rules); propagate assigned category consistently with aggregates. | `backend/` + `db/` + **`api_contract.md`** if surfaced |
| **8** | Duplicate upload guard: SHA-256 fingerprint and 409 Conflict | Raw multipart **`content_sha256`**, **`TRANSACTION_FILE`** lookup **`§11.2.1`**, **`409`** JSON (**camelCase**); persist fingerprint on successful file row (**stage 11**). | `backend/` + `db/` + **`api_contract.md`** + **`database/data_model.md`** |
| **9** | Block overlapping imports per user (single-flight) | Implement **`§11.2`** “still needed” mechanism (explicit error + retry semantics documented). | Likely `backend/` + infra/env if Dynamo conditional or lock row |
| **10** | Per-stage tracing/metrics | Emit duration + correlation with `import_file_id`; names TBD **`§11.2`** | `backend/` observability wrappers |
| **11** | Frontend: treat import start as cluster-id churn boundary | Invalidate / neutralise cluster-keyed caches on upload start; on **`200`** refetch authoritative lists **`§11.1.3`** | `frontend/` + pointer in **`api_contract.md`** SPA section if needed |

## Optional follow-on / explicitly deferrable (separate milestones)

Keep these **out** of the main sequence unless explicitly pulled forward—avoids blowing up review surface:

| Issue title | Notes |
| --- | --- |
| Persist raw blobs + orphan policy on persist failure | [`import_file_blob_storage.md`](../03_detailed_design/import_file_blob_storage.md), [`import_transaction_files.md` §4.8, §11.2.5](../03_detailed_design/import_transaction_files.md) |
| **Import staging (now/next) + promote / abort** | [`import_transaction_files.md` §8.7](../03_detailed_design/import_transaction_files.md), [`database/data_model.md` §8.5](../03_detailed_design/database/data_model.md) — **`DYNAMODB_IMPORT_STAGING_TABLE_NAME`**, reuse `userPartition` / restore copy patterns |
| Import blocked during backup restore lock | **`§11.2.4`** + restore docs alignment |
| SQS/worker scale-out | **`§4.8`** thresholds |
| Non-import entry point “start at pairing” | **`§4.6` Q8** |

Filed in Linear as **HOU-45** through **HOU-48** (see synced table above).

## Linear issue template (paste into descriptions)

````markdown
## Context
Implement / advance `import_transaction_files.md` §X.Y; preserves parity unless stated.
Design: `docs/03_detailed_design/import_transaction_files.md`

## Acceptance criteria
- [ ] …
- [ ] Contract/docs updated **in same change**: `api_contract.md` / `database/data_model.md` when behaviour or stored attributes change (`import_transaction_files.md` §10, §12).
- [ ] Targeted tests: …

## Review notes (for author)
- This PR intentionally does **[not]** change `<semantic area>`; follow-up `<issue stub>`.
- Call out any intentional behaviour flag for reviewers.

## Out of scope
- …
````

## Story dependency graph (textual)

Strict order for **minimal conflict**: **1 → 2 → 3 → 4 → 5** (scaffold → snapshot → persist → IDs → unified planning).

**6** (remint semantics) ideally after **5** once planning inputs/outputs stable.

**7** can trail **6** or ship in lockstep **only if** the diff stays reviewable—prefer trailing.

**8** can begin after **3**/`db` persistence shape is clear; often cleanest **after 5** so planning does not rework fingerprint plumbing.

**9–11** are parallel once core path is stable; **do not** block MVP remint correctness on observability/UI polish if product agrees.

## Risks / assumptions

- Corpus **remint** (**issue 6**) invalidates assumptions in any UI or client cache keyed by `cluster_id`; coordinate with **issue 11** release window.
- Duplicate guard (**issue 8**) requires consistent definition of **raw bytes** hashed (multipart file part)—document in **`api_contract.md`** precisely.
- `prior_cluster_ids` remains **planning-only** (**§11.1**)—do not expand scope into persisted lineage without product sign-off.

## Maintenance

If you rename issues or reschedule dependencies in Linear, update the table above so this file stays the repo-side index.
