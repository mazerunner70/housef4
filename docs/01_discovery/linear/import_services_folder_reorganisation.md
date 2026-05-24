# Linear delivery: import services folder reorganisation

## Purpose

This document indexes the **move-only** refactor that grouped import modules under topical subfolders in `backend/src/services/import/`, without changing orchestration behaviour. Authoritative stage ordering remains [`import_transaction_files.md` §4.2](../../03_detailed_design/import_transaction_files.md).

## Linear workspace

- **Team:** House f3 (key **HOU**).
- **Project:** [Import services folder reorganisation](https://linear.app/house-f4/project/import-services-folder-reorganisation-419f1a05-0ed6-4dc8-b295-a3615e8c850d).

## Folder layout (post-reorg)

| Subfolder | Modules | §4.2 stages |
| --------- | ------- | ----------- |
| *(root)* | `importOrchestration.ts`, `importOrchestrationSteps.ts`, `runImportPlanning.ts`, `importPersistPhase.ts`, `importStageTracing.ts`, `importLockHttp.ts` | **2–12** entry + tracing |
| `ingress/` | `multipartFile.ts` | **1** |
| `parse/` | `parseImportBuffer.ts`, `detectFormat.ts`, `parseCsv.ts`, `parseOfx.ts`, `parseQif.ts`, `amountNegation.ts`, `canonical.ts` | **3–4** |
| `planning/` | `allocateBatchIds.ts`, `ledgerSnapshot.ts`, `persistPlan.ts` | **5–6**, **9** |
| `clustering/` | `clusterPipeline.ts`, `clusterIdentity.ts`, `merchantNormalize.ts`, `merchantsEmbedder.ts`, `dbscanCosine.ts`, `categoryClassifier.ts`, `taxonomyV2.ts`, `stableClusterId.ts`, `index.ts` | **8** |
| `blob/` | `importBlobStore.ts`, `filesystemImportBlobStore.ts`, `s3ImportBlobStore.ts`, `importBlobPersist.ts`, `blobFingerprint.ts`, `importBlobKey.ts`, `importBlobConfig.ts`, `importBlobTypes.ts` | **2b**, post-promote blob |

**Unchanged:** `backend/src/services/pairing/` (stage **7**), `backend/src/handlers/imports.ts` (HTTP delegate).

## Issues (completed / doc follow-up)

| Issue | Title | Notes |
| ----- | ----- | ----- |
| HOU-49 | Move import parse modules into `parse/` subfolder | — |
| HOU-50 | Move import blob storage modules into `blob/` subfolder | — |
| HOU-51 | Move import ingress modules into `ingress/` subfolder | — |
| HOU-52 | Move import clustering modules into `clustering/` subfolder | — |
| **HOU-53** | Update design docs for import folder layout | Docs-only; paths in detailed design + this index |

## Design docs updated (HOU-53)

- [`import_transaction_files.md` §4.2 implementation pointers](../../03_detailed_design/import_transaction_files.md)
- [`import_observability.md`](../../03_detailed_design/import_observability.md) — `importStageTracing` at import root
- [`import_file_blob_storage.md`](../../03_detailed_design/import_file_blob_storage.md) — `blob/` module table
- [`transaction_analysis_clusters_and_categories.md` §4](../../03_detailed_design/transaction_analysis_clusters_and_categories.md) — `clustering/` paths

## Maintenance

When adding a new import submodule, place it under the matching subfolder (or add a new subfolder only when a cohesive vertical appears). Update the implementation pointer table in `import_transaction_files.md` in the same change.
