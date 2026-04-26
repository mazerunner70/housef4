# Transaction analysis: clusters and categories

This document defines the **two-layer model** used in ML experimentation ([`ml-training/notebooks/experimentation.ipynb`](../../ml-training/notebooks/experimentation.ipynb)) and outlines how to align it with the live backend. It complements the [`transaction_analysis_expert`](../../.agents/skills/transaction_analysis_expert/SKILL.md) skill (clustering, categorization, low-cost storage) and [`import_field_mapping.md`](./import_field_mapping.md) (canonical `raw_merchant`).

---

## 1. Why two layers?

| Layer | Role | User-visible outcome |
|--------|------|----------------------|
| **Clusters** | Group noisy bank descriptions into a **single merchant identity** so the system learns once and applies everywhere. | Fewer decisions: tag a cluster, not every row. |
| **Categories** | Map each cluster (or ambiguous rows) to the **product taxonomy** (Groceries, Housing, …). | Budgets, charts, and “essential vs discretionary” insights. |

Clusters answer **“which merchant is this?”** Categories answer **“what kind of spend is this?”** Categorisation should usually run **after** clustering so rules and embeddings operate on cleaner text and cluster-level signals.

---

## 2. Layer 1 — Merchant clusters (from the experimentation notebook)

The notebook builds **semantic clusters** on **cleaned** descriptions, not on raw strings.

### 2.1 Normalization and cleaning

1. **`clean_merchant_name`** — Uppercase; strip noise (transaction IDs, dates, payment rails like PayPal/Zettle, long numeric references, legal suffixes); normalize tokens (`S/MKTS` → `SUPERMARKET`, `PYMT` → `PAYMENT`); collapse whitespace.
2. **`remove_dd_mmm_dates`** — Remove patterns such as `ON 03 DEC` and common UK bank suffix codes (`CLP`, `BCC`, `DDR`, …).

Output: **`cleaned_description`**, the text used for embeddings and clustering.

### 2.2 Embeddings

- Model: **`sentence-transformers/all-MiniLM-L6-v2`** (384-dimensional vectors).
- Input: **`cleaned_description`** per transaction.

### 2.3 Density clustering

- Algorithm: **`sklearn.cluster.DBSCAN`** with **`metric='cosine'`**, **`eps=0.3`**, **`min_samples=3`**.
- Output: integer **`merchant_cluster_id`** per row. Label **`-1`** denotes **noise** (not assigned to a dense cluster).

Interpretation:

- **Cluster ≥ 0**: Multiple transactions fell in the same cosine neighborhood in embedding space → treated as one merchant group for downstream steps.
- **Cluster -1**: Isolated or rare descriptions → handled individually in categorisation (rules per row, then embedding-to-category).

### 2.4 Stable cluster identity in production (important)

DBSCAN labels are **dataset-relative**: re-running on a larger or smaller set can change IDs and groupings. The notebook is an **offline analysis** tool. For the app you need a **stable `cluster_id` string** (see [§5](#5-implementation-design-for-the-current-codebase)) such as a hash of a normalized key, an assigned id from a stored cluster table, or centroid-based assignment with persisted centroids.

---

## 3. Layer 2 — Categories (from the experimentation notebook)

Categories are **not** produced by DBSCAN. The notebook uses a **two-phase** classifier on top of **`merchant_cluster_id`** and the same embeddings.

### 3.1 Taxonomy as semantic anchors (behavioural)

Each category name is paired with a **short natural-language description** that captures **intent and spending behaviour** (e.g. discretionary vs essential), not only merchant type. Example labels from the notebook’s behavioural map include `Housing & Utilities`, `Groceries`, `Dining Out`, `Takeaways & Delivery`, `Telecom & Software`, `Entertainment & Leisure`, `Savings & Investments`, `Cash & Unknown`, and similar. Those descriptions are embedded with the **same** `all-MiniLM-L6-v2` model. This follows the skill’s requirement to map to the **official product taxonomy** (see PRD / personal finances expert); implementation should use **one** canonical **behavioural** category list in code and docs, aligned with [`experimentation.ipynb`](../../ml-training/notebooks/experimentation.ipynb) (V2 / behavioural `category_map` there).

### 3.2 Phase 1 — Regex rules (confidence 1.0)

- **Per cluster (id ≥ 0):** If **any** `cleaned_description` in the cluster matches a pattern, assign that **category to the whole cluster** (first matching pattern wins in the notebook).
- **Noise (-1):** Rules are applied **per transaction**; each row can match independently.

Rules encode high-precision merchant cues (supermarket names, banks, MaaS apps, etc.). This matches the skill’s emphasis on **sanitization + lightweight rules** before ML.

### 3.3 Phase 2 — Semantic similarity (confidence below 1)

For rows still unmatched:

- **Noise points:** Cosine similarity between the **transaction embedding** and **each category description embedding**; pick argmax (per-row scores).
- **Whole clusters:** Cosine similarity between the **mean embedding (centroid)** of the cluster and category description embeddings; one label for all rows in that cluster.

The notebook records **`match_type`** as `Rule` vs `ML` and a **numeric confidence** (1.0 for rules; rounded similarity for ML).

### 3.4 Human in the loop

Low-confidence ML suggestions should align with **review queue** behaviour: suggest a category but keep **`PENDING_REVIEW`** until the user confirms—consistent with [`transaction_analysis_expert`](../../.agents/skills/transaction_analysis_expert/SKILL.md) and existing `applyTagRule` / pending-cluster flows.

---

## 4. Current system (gap analysis)

Today, [`backend/src/services/import/enrichImportRows.ts`](../../backend/src/services/import/enrichImportRows.ts) defines:

- **`cluster_id`** = `CL_` + first 16 hex chars of SHA-256 of **trimmed, lowercased** `raw_merchant` (whitespace normalized only).
- **Category** = inherited from any prior **CLASSIFIED** transaction with the same `cluster_id`, else `Uncategorized` and **`PENDING_REVIEW`**.

There is **no** cleaning pipeline, **no** embeddings, **no** DBSCAN, and **no** automatic category suggestion from the **behavioural** taxonomy—so the notebook’s **Layer 1** and **Layer 2** are not yet implemented in the import path.

---

## 5. Implementation design for the current codebase

Below is a practical path that preserves existing types (`cluster_id`, `category`, `status`, `PendingClusterRecord.suggested_category`) and stays compatible with a future DynamoDB-centric layout.

### 5.1 Shared normalization module

- Add a **TypeScript** port of `clean_merchant_name` + `remove_dd_mmm_dates` (same regex semantics as the notebook, with unit tests from golden strings).
- **`raw_merchant`**: unchanged for display and audit.
- **`normalized_merchant`** (or `cleaned_merchant`): computed at import and stored if the schema allows, or stored only on cluster records—minimum is to compute in memory for clustering/categorisation.

### 5.2 Cluster id strategy: DBSCAN every import

Cluster assignment follows the notebook: **cleaned text → embeddings → DBSCAN** on the user’s **full** corpus after each import (details in [§5.2.1](#521-dbscan-on-every-import)). Raw DBSCAN integer labels are **not** persisted; each group is mapped to a **stable `cluster_id`** (e.g. hash of medoid cleaned string — §2.4, §5.3.1).

**Migrating** from the current hash-of-raw implementation: backfill `cluster_id` by re-running the pipeline on stored `raw_merchant`, or lift categories via overlap / secondary lookup (§5.3.1).

#### 5.2.1 DBSCAN on every import

DBSCAN itself is often **fast** on typical personal finance volumes (sklearn on a few thousand points in 384-dimensional space is usually seconds on CPU; GPU does not change DBSCAN much). What usually costs more is **generating embeddings** for every row you cluster: `all-MiniLM-L6-v2` over the **full** set of cleaned descriptions dominates wall time unless you **cache an embedding per transaction id** and only encode new or changed rows.

**Run DBSCAN on the user’s full relevant corpus**, not on the import file alone. With `min_samples=3` (as in the notebook), a batch of one or two new lines contains too little density to form clusters; you need existing history plus new rows so DBSCAN matches the intended behaviour.

**Yes, it can run on every import** if:

- **n per user** stays in a range you profile (rough guide: up to **~10⁴** rows is often acceptable with caching; beyond that consider async or scheduled clustering).
- You **map** each DBSCAN cluster to a **stable `cluster_id`** before writing transactions (e.g. hash of cluster **medoid** cleaned string, or centroid-derived key — see §2.4 and §5.3.1). Raw integers from each run will **change** when data changes; they must not be stored as the durable key.

**If import latency matters**, return quickly and run **embed → DBSCAN → remap** in a **background job**, then patch `cluster_id` / review queue when the job finishes.

### 5.3 Category assignment on import

1. Resolve **`cluster_id`** (from §5.2).
2. If the user already has a **CLASSIFIED** row for that `cluster_id`, keep current behaviour (inherit category).
3. Else compute **suggested category** using the notebook’s order:
   - Regex rules on **`cleaned_merchant`** (cluster-wide for DBSCAN groups with id ≥ 0; per row for noise — §3.2).
   - If no rule: **embedding similarity** to taxonomy descriptions (requires **ONNX** or a **small sidecar Lambda** calling a mini model—or defer ML to async job and start as `PENDING_REVIEW` with `suggested_category: null` until scored).
4. Set **`suggested_category`** on pending cluster records (already in [`db/src/dynamoFinanceRepository.ts`](../../db/src/dynamoFinanceRepository.ts)) from the classifier output.
5. Set **`status`**: `CLASSIFIED` only when confidence ≥ configurable threshold **and** policy allows auto-accept; otherwise `PENDING_REVIEW` with suggested category for the UI.

#### 5.3.1 Preserving cluster and category mappings on later imports (including notebook noise)

You do not lose prior mappings if **learning is keyed on stable production identities**, not on offline DBSCAN labels.

**1. Never use raw DBSCAN labels as `cluster_id`.** Integer labels from a notebook or batch job (`0`, `3`, `-1`, …) are **not durable** across runs (§2.4). Persist only a **stable** id (e.g. `CL_<hash(normalized_merchant)>` or a persisted UUID tied to a cluster record). Offline `-1` is an analysis artifact; it should not appear in the database as the user’s cluster key.

**2. How “-1” maps in production.** Rows that *look* like noise in a one-off DBSCAN run should still receive a **deterministic singleton** `cluster_id` in the app (same normalized string → same id). When the user classifies one of those transactions, they are classifying that **stable id**. A **later import** of the same merchant line (after the same normalizer) resolves to the **same** `cluster_id`, so the existing **CLASSIFIED** / tag-rule behaviour in step 2 above still applies and the category is retained.

**3. If you change how `cluster_id` is computed** (new regex in the cleaner, switch from hash(raw) to hash(cleaned), new embedding centroids):

- **Backfill**: Recompute the new `cluster_id` from stored `raw_merchant` for all historical rows, then **lift** categories: for each new id, take the category from any overlapping old cluster that had a **CLASSIFIED** row (or from explicit `CLUSTER#` `assigned_category` if you store it).
- **Secondary lookup (transition)**: After resolving by `cluster_id`, optionally **fallback**: any **CLASSIFIED** transaction for this user with the **same `cleaned_merchant`** (or same legacy id in an alias table) inherits the category. That avoids a one-time formula change from wiping user work while migrations run.
- **Explicit cluster items**: If you introduce `CLUSTER#` records, migrate by **matching normalized exemplar strings** and copying `assigned_category` to the new key.

**4. DBSCAN runs without losing tags.** Each run may assign different integer labels; do **not** write those integers as the durable `cluster_id`. Compute one **canonical stable id per group** (e.g. hash of medoid cleaned string, or stored UUID) and attach user labels to **that**. Re-runs may merge or split groups; reconciliation then uses **normalized string overlap** or **centroid distance**, not “cluster 7 from last month.”

In short: **user truth lives on stable merchant identity**, not on `-1` or ephemeral DBSCAN indices; singleton-style ids for “noise-like” merchants are how those rows stay classifiable and re-import-safe.

### 5.4 Configuration

- **Taxonomy**: single **behavioural** source of truth — load from config or a small JSON module aligned with the PRD; avoid duplicating alternate taxonomies in the backend.
- **Thresholds**: `RULE_CONFIDENCE = 1.0`, `ML_AUTO_CLASSIFY_MIN` (e.g. 0.45); **`DBSCAN` params** (`eps`, `min_samples`, `metric`) aligned with the notebook and tuned in `ml-training/` before production.

### 5.5 ML training vs runtime

- Keep **heavy** work (grid search, DBSCAN tuning, embedding sweeps) in **`ml-training/`** and Dockerized Jupyter per the skill.
- Ship **only** deterministic normalizers + optional **fixed** embedding inference artifact to production to control cost and cold start.

### 5.6 Data model sketch (optional extension)

| Entity | Purpose |
|--------|---------|
| **`USER#…` / `CLUSTER#<cluster_id>`** | `normalized_exemplar`, `assigned_category`, `suggested_category`, `embedding_centroid` (optional), `last_recomputed_at`. |
| **Transactions** | Keep `cluster_id`, `category`, `status`; optionally `category_confidence`, `match_type` for analytics and UI badges. |

The **implemented** DynamoDB items (transactions, cluster rows, **transaction file** import-history rows, profile, and GSI1 for cluster-wide updates) are described in [`database/data_model.md`](./database/data_model.md). Optional fields in the table above (e.g. `embedding_centroid` on a cluster) are design extensions; keep this section aligned with that file when the storage model evolves.

---

## 6. Agent review, rollout proposal, and user visibility

### 6.1 Agent review of this design

Before treating this document as **implemented truth**, have **repository agents** (Cursor skills) review it so the design stays consistent with taxonomy, storage, and product goals.

| Skill | Review focus |
|--------|----------------|
| [`transaction_analysis_expert`](../../.agents/skills/transaction_analysis_expert/SKILL.md) | Clustering pipeline (normalize → embed → DBSCAN), rule-vs-ML layering, review queue, low-cost access patterns. |
| [`personal_finances_expert`](../../.agents/skills/personal_finances_expert/SKILL.md) | **Behavioural** category list matches PRD / MVP docs; no ad-hoc category names in code. |
| [`db_admin`](../../.agents/skills/db_admin/SKILL.md) | `cluster_id`, optional `cleaned_merchant`, `suggested_category`, confidence fields; migrations and GSIs if the review queue grows. |

**Suggested review prompt for agents:** “Read `transaction_analysis_clusters_and_categories.md` and the current import/review code; list gaps, risks (stable id drift, latency), and concrete file-level changes. Propose the smallest next phase that preserves user mappings (§5.3.1).”

Agents should **not** silently swap taxonomy or DBSCAN parameters—changes belong in **`ml-training/`** with notebook evidence, then flow into config (§5.4).

### 6.2 Recommended design to proceed (phased)

This is the **default sequence** agents should suggest unless profiling or product constraints say otherwise. It prioritizes **visibility** (user can see clusters and categories early) before full ML parity.

| Phase | Scope | User visibility |
|--------|--------|------------------|
| **1 — Foundation** | TypeScript **normalizer** (§5.1) with tests; persist **`cleaned_merchant`** (or derive consistently on read). Wire **review queue** and transaction APIs so responses include **`cluster_id`**, **`category`**, **`status`**, and **`suggested_category`** wherever the backend already provides them. *If production clustering is not ready yet, `cluster_id` may temporarily remain the legacy hash (§4); the UI still shows the field so later DBSCAN results drop in without a redesign.* | User sees **cluster** and **category** on each transaction and on **pending clusters** ([`listPendingClusters`](../../backend/src/handlers/reviewQueue.ts)); can tell **suggested** vs **confirmed** when exposed. |
| **2 — DBSCAN + categorisation** | **Embedding cache** per transaction; **async** embed → DBSCAN → **stable `cluster_id`** (§5.2–5.2.1); populate **`suggested_category`** and **confidence** from rules + semantic phase (§3). | **Import summary** (new txns, clusters updated, **needs review**); review queue shows **sample merchants per cluster** (`PendingClusterRecord`) with suggestions. |
| **3 — Polish** | Tune **`ML_AUTO_CLASSIFY_MIN`**, expand regex from `ml-training` exports; optional **cluster explorer** (browse all clusters, exemplar, volume). | User confirms or overrides with full context; auto-classify only when policy allows (§5.3). |

**Hand-off between phases:** Phase 1 delivers **visibility** first. Phase 2 replaces legacy clustering with the **notebook-aligned DBSCAN** path and richer suggestions; Phase 3 tightens automation without removing the user’s ability to **inspect** clusters and categories.

### 6.3 Letting the user view clusters and categories

The product should assume the user **reviews** groups and labels—not only raw rows.

**Minimum (aligns with existing types):**

- **Transaction list / detail:** Show **`raw_merchant`**, **`cluster_id`**, **`category`**, **`status`** (`CLASSIFIED` vs `PENDING_REVIEW`). When the API exposes them, show **`suggested_category`** and **confidence** so the user understands why something is in the queue.
- **Review queue:** [`PendingClusterRecord`](../../db/src/types.ts) already supports **`cluster_id`**, **`sample_merchants`**, **`suggested_category`**, totals—surface these in the UI as the primary **cluster-level** review screen: user picks or corrects the **category for the cluster** (tag rule), which matches §3.4 and `applyTagRule`.

**Strongly recommended:**

- **Post-import summary:** After upload, show “Imported *n* transactions; *k* clusters need category confirmation” with a CTA to the review queue—so the user **sees** the impact of clustering before diving into the full ledger.
- **Optional cluster explorer:** For power users, a view grouped by **`cluster_id`** with exemplar cleaned string, transaction count, and assigned category—mirrors the mental model in §1.

**API contract:** Extend [`api_contract.md`](./api_contract.md) when adding `cleaned_merchant`, `suggested_category`, or `category_confidence` on transactions so the frontend can render the above without guessing.

---

## 7. Summary

- **Clusters** in the notebook = **cleaned text → MiniLM embedding → DBSCAN (cosine, eps 0.3, min_samples 3)**, with **-1** as noise.
- **Categories** = **regex rules first**, then **embedding similarity** to taxonomy **descriptions**, applied at **cluster level** when the cluster is known, else **per row** for noise.
- The **live app** today uses a **single-layer** hash of raw merchant; moving to the two-layer model means **shared cleaning**, a **stable `cluster_id` policy**, and **rules + optional ML** for **`suggested_category`** and review thresholds—while keeping user **tag rules** as the source of truth once confirmed.
- **Agents** should review changes against §6.1; **proceed** in the phased order in §6.2; **users** should always have UI paths to **see clusters and categories** (§6.3), especially via the review queue and import summary.

---

## Index

| Topic | Section |
|--------|---------|
| Two-layer rationale | [§1](#1-why-two-layers) |
| Cluster pipeline (notebook) | [§2](#2-layer-1--merchant-clusters-from-the-experimentation-notebook) |
| Category pipeline (notebook) | [§3](#3-layer-2--categories-from-the-experimentation-notebook) |
| Current backend | [§4](#4-current-system-gap-analysis) |
| Implementation design | [§5](#5-implementation-design-for-the-current-codebase) |
| DBSCAN on every import | [§5.2.1](#521-dbscan-on-every-import) |
| Preserving mappings / DBSCAN noise | [§5.3.1](#531-preserving-cluster-and-category-mappings-on-later-imports-including-notebook-noise) |
| Agent review, rollout, user visibility | [§6](#6-agent-review-rollout-proposal-and-user-visibility) |
| Summary | [§7](#7-summary) |
