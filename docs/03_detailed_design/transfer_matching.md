---
title: Internal transfer detection and match_id
stage: Detailed Design
phase: Ingestion / analytics
---

# Internal transfer detection and `match_id`

This document specifies how the product **detects money moving between a user’s own accounts** (internal transfers), links the two legs with a shared **`match_id`**, and **excludes** those rows from **merchant clustering** and related category assessments. It complements [`import_field_mapping.md`](./import_field_mapping.md) (canonical fields and import profiles), [`import_transaction_files.md`](./import_transaction_files.md) (import pipeline and `cluster_id` lifecycle), [`transaction_analysis_clusters_and_categories.md`](./transaction_analysis_clusters_and_categories.md) (clustering layers), and the physical layout in [`database/data_model.md`](./database/data_model.md).

**Naming note:** The existing transaction field **`match_type`** means **how categorization was matched** (e.g. rule vs ML). It must **not** be overloaded for transfer pairing. **`match_id`** is reserved for **internal transfer legs** only.

**Status:** Intended behaviour for implementation. Until the pipeline persists `match_id`, clustering should behave as today; once `match_id` is written, clustering **must** skip those rows as specified below.

---

## 1. Goals

- Reduce distortion in **spend / income metrics** and **merchant clusters** from movements that are **balance reallocations**, not consumption.
- Link each leg to its partner with a shared **`match_id`** for reporting, future reconciliation UX, and exclusion rules.
- Choose the partner leg by **smallest inverse amount residual** among candidates within **±4 calendar days** on **different** accounts.
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
| Time | `date(B)` ∈ `[date(A) − 4d, date(A) + 4d]` inclusive, using the **same date field** as the rest of the product (post date vs transaction date — pick one and keep it consistent). |
| Inverse residual | Let r = amount(A) + amount(B). Require &#124;r&#124; ≤ ε (§3.1). |

### 3.1 Tolerance ε

- If amounts are **integer cents**, **ε = 0** may suffice.
- Otherwise use **ε = 1 cent** or **`max(1¢, 0.01 × min(|A|, |B|))`** for minor rounding; choose one policy and centralize it in config.

### 3.2 Currency

Only consider pairs with the **same `currency`** (or single-currency product assumptions). FX-aware pairing is a **future extension**.

---

## 4. Partner selection: smallest inverse difference

For each transaction **A**:

1. Enumerate all candidates **B** (§3).
2. Score each pair with **`s = |amount(A) + amount(B)|`** (smaller **s** is better).
3. **Tie-breakers** (deterministic): smaller **calendar distance** `|date(A) − date(B)|`, then **lexicographic** `transaction_id` (or `(account_id, id)`).

### 4.1 Global one-to-one assignment

Greedy “each A picks best B” without locking allows **two As to claim the same B**. Use:

1. **Proposal phase:** For every as-yet-unpaired **A**, compute its best **B** and score **s**.
2. **Resolution phase:** Sort all proposed pairs by **s** ascending, then **greedily accept** a pair only if **both** endpoints are still unpaired; assign a new shared **`match_id`** to both rows.

Optionally replace step 2 with a **minimum-cost bipartite matching** if collision rates are high.

### 4.2 `match_id` format

- **Opaque UUID** (or ULID) generated when a pair is accepted; **both** legs store the **same** `match_id`.
- Deterministic ids from `hash(sorted(idA, idB))` are possible but complicate **splitting** pairs later; UUID is the default recommendation.

### 4.3 Idempotent re-runs

Re-running auto-detection should **not** leave stale links:

- Clear **`match_id` only** for rows where **`match_source = 'auto'`** (or unset) before recomputing.
- Rows confirmed or linked by the user (**§8**) should use **`match_source = 'user'`** and **must not** be silently unpaired by auto runs (product rule).

---

## 5. Optional metadata

| Field | Purpose |
|--------|---------|
| **`match_confidence`** | e.g. `exact` vs `within_epsilon` for future UI and ranking on a review page. |
| **`match_source`** | `auto` \| `user` — separates pipeline from manual overrides. |

---

## 6. Persistence and API

When implemented:

- Add **`match_id`** (and optional fields above) to the **transaction** item in DynamoDB; update [`database/data_model.md`](./database/data_model.md) and **`GET /api/transactions`** (and CSV export if applicable) per [`api_contract.md`](./api_contract.md).
- **Backup JSON** should include `match_id` when present (extend [`backup-schema/v1.md`](./backup-schema/v1.md) or a new version if needed).

---

## 7. Clustering and category assessment exclusion

**Rule:** Any transaction with **`match_id` set (non-null)** must be **excluded** from:

- **Merchant clustering** (assignment or update of `cluster_id`, embeddings used for cluster discovery, etc.).
- **Category assessment** that drives **spend/income behaviour** (same class of analytics where internal transfers would distort insights).

**Still allowed:** Ledger views, raw lists, exports, and optional **transfer-specific** reports.

The import pipeline and any batch job that **reclusters** must **filter out** `match_id` rows **before** cluster logic, or **skip** applying cluster updates to those rows if they are already marked.

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

- [`import_transaction_files.md`](./import_transaction_files.md) — import batch and `cluster_id` writes.
- [`transaction_analysis_clusters_and_categories.md`](./transaction_analysis_clusters_and_categories.md) — cluster vs category layers.
- [`database/data_model.md`](./database/data_model.md) — transaction attributes.
