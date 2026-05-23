---
title: Transfer pairing — centre / left / right window algorithm
stage: Detailed Design
phase: Reasoning / implementation
---

# Transfer pairing: centre-driven sliding window (design reasoning)

This note matches [`transfer_matching.md`](./transfer_matching.md) §3–4 with the **simple time rule**: compare stored transaction timestamps (**epoch ms**) directly against **`W × 86 400 000`**. It uses four mechanical ideas — **merge**, **`centre`**, **`left`**, **`right`** — and optional pure-shaped steps.

**Implementation:** [`transferPairing.ts`](../../db/src/transferPairing.ts) applies this **epoch-ms** window and pointer sweep.

---

## 1. Input

Each transaction has **`id`**, **`account_id`**, **`date`** (epoch ms), **`amount`**, optional **`currency`**.

Define **`Δ_ms = W × 86 400 000`** (default **W = 4** matches [`transfer_matching.md`](./transfer_matching.md)).

**Goal:** For **each transaction** in turn (§3 **`centre`**), choose its **best partner** among rows where **`|date(centre) − date(candidate)| ≤ Δ_ms`** and §3’s other rules hold; require **`|amount(centre)+amount(candidate)| ≤ ε`**, then among feasible candidates prefer **smallest** **`|date(centre) − date(candidate)|`** and §4 tie-breaks; then assign according to [`transfer_matching.md`](./transfer_matching.md) §4’s **ordered root walk** (best **available** **B** per root) or optional bipartite matching — not a separate sort of all proposals.

---

## 2. Merge and sort

1. Merge incoming batches into one array **`merged`** before pairing.
2. Sort **`merged`** ascending by **`date`**, tie-break **`(account_id, id)`**.

**Invariant:** The anchor timestamp **`merged[centre].date`** defines **`minT`** / **`maxT`** below; **`left`** / **`right`** only locate indices around it.

---

## 3. `centre`, `left`, `right`

For **`t = merged[centre].date`**:

- **`minT = t − Δ_ms`**
- **`maxT = t + Δ_ms`**

| Symbol | Meaning |
|--------|--------|
| **`centre`** | Index of the transaction currently seeking a partner. In a **full recalculate**, walk **every** index (each transaction), ordered by non-decreasing **`merged[centre].date`**. |
| **`left`** | First index **≥ `leftHint`** with **`merged[left].date ≥ minT`**. |
| **`right`** | **Exclusive:** smallest index **≥ `left`** where **`right === merged.length`** or **`merged[right].date > maxT`**. Candidates are **`left ≤ i < right`**. |

Exclude **`i === centre`** when scoring. Eligibility filters still apply (§6).

**Symmetric window:** **`left`** can be **`< centre`** — candidates **before** the anchor index remain inside **`[minT, maxT]`** by timestamp.

---

## 4. Pointer sweep

Non-decreasing **`merged[centre].date`** for **`centre`**. Hints **`leftHint`**, **`rightHint`** (start **`0`**):

1. **`minT`**, **`maxT`** from **`merged[centre].date`**.
2. **`left`** from **`leftHint`**: advance while **`left < merged.length`** and **`merged[left].date < minT`**.
3. **`r = max(left, rightHint)`**; while **`r < merged.length`** and **`merged[r].date ≤ maxT`**, **`r++`**; **`right = r`**.
4. Set **`leftHint = left`**, **`rightHint = right`** for the next **`centre`**.

**Rough complexity:** sort **`O(n log n)`**; amortised sweep **`O(|merged| + Σ k)`** where **`k`** is typical slice width.

---

## 5. Half-open vs inclusive slice

- **Half-open:** **`left ≤ i < right`** (recommended).
- **Inclusive:** last index with **`merged[i].date ≤ maxT`**.

---

## 6. Who may pair (inside the slice)

[`transfer_matching.md`](./transfer_matching.md) §3: distinct **`id`**, distinct **`account_id`**, **`currency`** guard.

---

## 7. Scoring one centre’s choice

Among eligible **`B`** in **`[left, right)`**:

1. Let **`s = |amount(A) + amount(B)|`**. Require **`s ≤ ε`** (**`s`** is not used to rank among partners that pass).
2. Among **`B`** with **`s ≤ ε`**, minimize **`|date(A) − date(B)|`**.
3. Tie: lexicographic **`(account_id, id)`** on **B**.

Collect **`(A, B, s, …)`** for assignment ( **`s`** for **`pairing_confidence`** / review only).

---

## 8. Global assignment

Per [`transfer_matching.md`](./transfer_matching.md) §4: process **roots** in a fixed order; for each unpaired root, after choosing its best **available** **B** from §7, assign **`pairing_*`** immediately — no need to gather every proposal and sort by **`|Δt|`** unless you implement an equivalent two-phase matcher.

---

## 9. Pure-shaped steps (optional naming)

| Step | Role |
|------|------|
| **`mergeSortedTransactions`** | Merge two sorted lists → **`merged`**. |
| **`windowHalfOpen`** | **`merged`**, **`centre`**, **`Δ_ms`**, hints → **`left`**, **`right`**, next hints. |
| **`bestPartnerInWindow`** | Best **available** **`B`** in **`[left, right)`** for **`merged[centre]`** (§7; skip legs already paired). |
| **`assignPairingsByRootOrder`** | §4 ordered walk — emit **`pairing_*`**. |

---

## 10. Code (`db`)

[`computeAutoTransferPairingsSortedPools`](../../db/src/transferPairing.ts) merges sorted pools, advances **`left` / `right`** with **`merged[centre].date ± Δ_ms`**, then runs the §4 ordered root walk (eligible roots only on ingest).

---

## 11. Checklist

- [x] **`merged`** sorted before scanning.
- [x] **`minT` / `maxT`** from **`merged[centre].date` ± Δ_ms**.
- [x] Slice includes indices **before** **`centre`** when timestamps remain inside the band.
- [x] Exclude **`centre`** from its own candidates.
- [x] Assign pairings after each root’s candidate scan (§4), or equivalent global assignment.

---

## 12. References

- [`transfer_matching.md`](./transfer_matching.md)
- [`db/src/transferPairing.ts`](../../db/src/transferPairing.ts)
