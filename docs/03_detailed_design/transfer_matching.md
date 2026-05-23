---
title: Internal transfer detection and pairing_id
stage: Detailed Design
phase: Ingestion / analytics
---

# Internal transfer detection and `pairing_id`

This document specifies how the product **detects money moving between a user’s own accounts** (internal transfers), links the two legs with a shared **`pairing_id`**, and **excludes** those rows from **merchant clustering** and related category assessments. It complements [`import_field_mapping.md`](./import_field_mapping.md) (canonical fields and import profiles), [`import_transaction_files.md`](./import_transaction_files.md) (import pipeline, **`cluster_id` lifecycle**, **§8.7** staging promote), [`transaction_analysis_clusters_and_categories.md`](./transaction_analysis_clusters_and_categories.md) (clustering layers), and the physical layout in [`database/data_model.md`](./database/data_model.md).

**Naming note:** The existing transaction field **`match_type`** means **how categorization was matched** (e.g. rule vs ML). Transfer pairing uses **`pairing_id`**, **`pairing_source`**, and **`pairing_confidence`** so **`match_*`** is not overloaded across categorization vs transfers.

**Status:** Optional **`pairing_id`** / **`pairing_source`** / **`pairing_confidence`** fields are persisted and flow through **`GET /api/transactions`**, CSV export, and backup **v1** round-trip **when present**. Reads accept legacy Dynamo / backup keys **`match_id`** / **`match_source`** / **`match_confidence`** and normalize to **`pairing_*`** on export and APIs. **Automatic pairing on import** (§4.4) assigns **`pairing_*`** for eligible legs before clustering. **§7** exclusion applies on import to **every** row with **`pairing_id`** persisted, not only legs matched in that batch. Any future **offline reclusters** still need the same filter.

---

## 1. Goals

- Reduce distortion in **spend / income metrics** and **merchant clusters** from movements that are **balance reallocations**, not consumption.
- Link each leg to its partner with a shared **`pairing_id`** for reporting, future reconciliation UX, and exclusion rules.
- Choose the partner leg among candidates whose timestamps fall within **W × 86 400 000 ms** of each other (default **W = 4** nominal “days”) on **different** accounts (§3), with **`|amount(A)+amount(B)| ≤ ε`**, then **prefer the smallest time gap** `|date(A)−date(B)|` among amount-feasible partners (§4).
- Define a **consistent canonical sign** for `amount` across account types and imports (especially **credit card** CSVs).

**Non-goals (this phase):** Perfect precision with no user feedback; building the **review page** (see §8).

---

## 2. Canonical amount representation

All **transfer matching** runs on the **same canonical signed `amount`** stored on the transaction (or an equivalent normalized field if raw is retained separately).

### 2.1 Import profile

- **Per-account** (or per-import-profile) metadata defines how **raw** file columns map to **`amount`**.
- Suggested enums: **`amountConvention`** such as `EXPENSE_OUTFLOW_POSITIVE` | `INFLOW_POSITIVE` | `AS_EXPORTED`, plus optional **`invertAmount: boolean`** for odd exports.
- **Account type** (`checking` \| `savings` \| `credit_card` \| …) supplies **defaults** when a new account is created; **do not** infer sign from “credit card” alone without the profile, because bank CSV conventions differ.

### 2.2 Policy (locked)

Canonical **`amount`** is **signed relative to that account**:

- **Negative:** money flowing **from** the account (outflow)—e.g. card charges, withdrawals, outbound transfers, debit card spends.
- **Positive:** money flowing **into** the account (inflow)—e.g. salary credits, refunds to the account, inbound transfers.

This matches persisted transactions, dashboards/metrics, and [`database/data_model.md`](./database/data_model.md). Bank and card exports disagree on raw signs ([`import_field_mapping.md`](./import_field_mapping.md) §8); mapping and **`format.amount_negated`** exist so every import path yields this convention. Every profile answers: “How does this file’s columns map **into** that?”

Optional later: validation warnings when a profile yields implausible series (out of scope for v1 of this doc).

---

## 3. Transfer candidate rule

Transaction **B** is a **candidate partner** for **A** if:

| Rule | Detail |
|------|--------|
| Accounts | `account_id(A) ≠ account_id(B)` (or equivalent account key used in the app). |
| Time | **`|date(A) − date(B)| ≤ W × 86 400 000`**, where **`date(*)`** is stored **epoch milliseconds** and **W** is a configurable half-width in nominal days (default **4**). Use the **same transaction timestamp field** everywhere (post date vs transaction date — pick one and keep it consistent). |
| Inverse residual | Let r = amount(A) + amount(B). Require &#124;r&#124; ≤ ε (§3.1). |

### 3.1 Tolerance ε

- If amounts are **integer cents**, **ε = 0** may suffice.
- Otherwise use **ε = 1 cent** or **`max(1¢, 0.01 × min(|A|, |B|))`** for minor rounding; choose one policy and centralize it in config.

### 3.2 Currency

Only consider pairs with the **same `currency`** (or single-currency product assumptions). FX-aware pairing is a **future extension**.

### 3.3 Doc vs implementation

**`db`** pairing uses the §3 **`W × 86 400 000` ms** rule and the centre / left / right sweep in [`transfer_matching_centre_window_algorithm.md`](./transfer_matching_centre_window_algorithm.md).

During **ingest**, the counterpart pool excludes any **existing** row that already persists **`pairing_id`**, so a leg from a committed pair cannot be reused as **B** for another auto pair (**§4.1** persistence layer).

---

## 4. Partner selection: ε gate, then closest in time

**Root:** the transaction currently seeking a partner — call it **A**. The other leg is **B**. (This is not a tree “root”; it is just the directed **from** side of a pairing attempt.)

Let **`s = |amount(A) + amount(B)|`**. Candidates **must** satisfy **`s ≤ ε`** (§3). **`s`** is **not** used to rank partners among pairs that pass tolerance (it is the eligibility check and optional **`pairing_confidence`** / review metadata).

**Assignment — one ordered pass (no separate “collect proposals, then resolve” step):**

1. Fix a **deterministic order** over **proposal roots** — the transaction ids that may initiate a pair this run (during **ingest**, typically **new rows only** so auto-detection does not create **existing↔existing** pairs). Use the same order the implementation relies on for reproducibility (e.g. ascending **`date`**, then **`(account_id, id)`**).
2. Walk that list in order. For each root **A** that is **still unpaired**:
   - **Iterate** every **candidate B** for **A** under §3 (time window, different account, currency, etc.).
   - Keep only candidates with **`s ≤ ε`** and where **B** is **still unpaired**.
   - If none remain, **A** gets no auto partner this pass.
   - Otherwise choose **B** with the **smallest** **`|date(A) − date(B)|`** (epoch ms). **Tie-break:** lexicographic **`(account_id, id)`** on **B**.
   - Assign a new shared **`pairing_id`** to **A** and **B**, and set **`pairing_confidence`** from **`s`** as needed.

No buffer of proposed pairs is required: after scanning candidates for **A**, you commit to the single best **available** **B** or skip.

### 4.1 One-to-one and alternatives

Each leg may appear in **at most one** pair. The ordered pass above enforces that by only choosing **B** that are not yet paired.

If multiple roots compete for the same **B**, **whoever is earlier in the root order** claims **B**; a later root must take its **next-best available** candidate or stay unpaired. For higher pairing rate when collisions are common, optionally replace the walk with **minimum-cost bipartite matching** (e.g. edge cost **`|date(A) − date(B)|`** with the same tie-breaking on **B**).

### 4.2 `pairing_id` format

- **Opaque UUID** (or ULID) generated when a pair is accepted; **both** legs store the **same** `pairing_id`.
- Deterministic ids from `hash(sorted(idA, idB))` are possible but complicate **splitting** pairs later; UUID is the default recommendation.

### 4.3 Idempotent re-runs

Re-running auto-detection should **not** leave stale links:

- Clear **`pairing_id` only** for rows where **`pairing_source = 'auto'`** (or unset) before recomputing.
- Rows confirmed or linked by the user (**§8**) should use **`pairing_source = 'user'`** and **must not** be silently unpaired by auto runs (product rule).

### 4.4 Algorithm summary

1. **Candidates** — Same rules as §3 (different accounts, **`|date(A) − date(B)| ≤ W × 86 400 000`**, **`s ≤ ε`**, optional currency guard).

2. **Ordered roots** — Choose which rows may act as **A** (ingest: **new import rows only** for the new↔existing pattern).

3. **Per root** — In root order, for each unpaired **A**, scan all candidates **B**; among those with **`s ≤ ε`** and unpaired **B**, pick **B** with minimum **`|date(A) − date(B)|`**, tie **(account_id, id)** on **B**; assign shared **`pairing_id`**, **`pairing_source: auto`**, **`pairing_confidence`** from **`s`**.

**Ingest performance:** Counterpart legs (scoped existing rows) and new legs are **sorted by date**, **merged**, and candidate search can use a **sliding window on timestamps** (**`merged[i].date ∈ [t_c − W·86400000, t_c + W·86400000]`** for centre **`t_c`**) so work scales with the **density of rows in that ms band**, not one full scan of all history per row (see companion note below).

For a step-by-step reasoning model (**merge**, **`centre`**, **`left`**, **`right`**, pure-function decomposition, relation to code), see [`transfer_matching_centre_window_algorithm.md`](./transfer_matching_centre_window_algorithm.md).

---

## 5. Optional metadata

| Field | Purpose |
|--------|---------|
| **`pairing_confidence`** | e.g. `exact` vs `within_epsilon` for future UI and ranking on a review page. |
| **`pairing_source`** | `auto` \| `user` — separates pipeline from manual overrides. |

---

## 6. Persistence and API

**Implemented:** optional **`pairing_id`**, **`pairing_source`**, and **`pairing_confidence`** on Dynamo **`TRANSACTION`** items (canonical); **`GET /api/transactions`**, CSV export, and **backup v1** emit them when present (see [`database/data_model.md`](./database/data_model.md), [`api_contract.md`](./api_contract.md), [`backup-schema/v1.md`](./backup-schema/v1.md)). Legacy stored keys **`match_*`** are still read. **Import ingest** runs **automatic pairing** (§4.4) for eligible legs before clustering, using **`pairing_source: auto`** where assigned.

**Partial / pending:** Full **re-run** behaviour (clear **`pairing_source: auto`** only before recompute across all history) and **user** override plumbing (review UI — §8).

- **Backup JSON** includes **`pairing_*`** (and sibling fields when present); **`POST /api/backup/restore`** still accepts older snapshots that used **`match_*`** for the same semantics.

---

## 7. Clustering and category assessment exclusion

**Rule:** Any transaction with **`pairing_id` set (non-null)** must be **excluded** from:

- **Merchant clustering** (assignment or update of `cluster_id`, embeddings used for cluster discovery, etc.).
- **Category assessment** that drives **spend/income behaviour** (same class of analytics where internal transfers would distort insights).

**Still allowed:** Ledger views, raw lists, exports, and optional **transfer-specific** reports.

The import pipeline and any batch job that **reclusters** must **filter out** `pairing_id` rows **before** cluster logic, or **skip** applying cluster updates to those rows if they are already marked.

This aligns with the clustering model described in [`transaction_analysis_clusters_and_categories.md`](./transaction_analysis_clusters_and_categories.md): internal transfers are not “merchants” and should not participate in merchant/cluster learning.

---

## 8. Later extension: review page

A dedicated **Transfers** (or **Matched movements**) experience should eventually let users:

- Inspect auto-detected pairs (residual, dates, accounts).
- **Unlink** incorrect pairs or **manually link** two rows.
- Preserve **user** overrides when auto-detection runs again (**§4.3**).

This document does **not** specify UI or API for that page; implementation can follow in a separate epic.

---

## 9. References

- [`import_transaction_files.md`](./import_transaction_files.md) — import batch and `cluster_id` writes; **§8.7** import staging (now/next promote).
- [`transaction_analysis_clusters_and_categories.md`](./transaction_analysis_clusters_and_categories.md) — cluster vs category layers.
- [`database/data_model.md`](./database/data_model.md) — transaction attributes.
