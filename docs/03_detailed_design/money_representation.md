---
title: Money and currency representation
stage: Detailed Design
phase: Domain / persistence
---

# Money and currency representation

Canonical design for monetary values and multi-currency rules in housef4. Extends [HOU-32](https://linear.app/house-f4/issue/HOU-32) (integer minor units). **No backward compatibility** with pre-account-currency or legacy float-amount rows — non-prod data may be wiped rather than migrated.

| Artifact | Role |
|----------|------|
| [`@housef4/money`](../../../money/src/index.ts) | `Currency` enum, `Money` class, parse/format, strict errors (`MoneyError`) |
| [`db/src/storedAmount.ts`](../../../db/src/storedAmount.ts) | Dynamo ↔ domain mappers (target) |
| [`database/data_model.md`](./database/data_model.md) | Physical attributes |
| [`api_contract.md`](./api_contract.md) | Wire JSON and HTTP errors |

---

## 1. Core types

### `Currency`

- Closed enum: **`Currency.USD`**, **`Currency.EUR`**, … (see `money/src/currency.ts`).
- Each value has **`id`** (ISO 4217), **`name`**, **`symbol`**, and **`scale`** (minor-unit exponent: major = units / 10^scale).
- Parsed at boundaries via **`parseCurrency(code)`** (throws **`MoneyError`** when unsupported or empty).
- **`resolveCurrency(input)`** accepts a `Currency` value or ISO string.

### `Money`

- **`Money`** class — signed **integer** minor units only (`Money.of(units)` / **`money(units)`**).
- **`fromMajor`**, **`toMajor`**, **`formatAmount`**, **`parseDecimalString`** require a known **`Currency`** (strict; no silent defaults).
- Instance helpers: **`add`**, **`subtract`**, **`abs`**, **`negate`**, **`isZero`**, **`equals`**, etc.

**Do not** embed `currency` inside every `Money` value when work is scoped to a single account (currency comes from **`account.currency`**). Pass `Currency` into parse/format helpers at boundaries.

### Naming convention (TypeScript)

| Rule | Example |
|------|---------|
| Variables of type **`Money`** use the suffix **`Amount`** | `canonicalAmount`, `fileAmount`, `totalAmount`, `incomeAmount` |
| Reserve the word **`amount`** for **`Money`** values only | Avoid `monthlyIncome` as `Money`; prefer `monthlyIncomeAmount` |
| Wire JSON / CSV DTOs | Keep **`amount`** as **major-unit decimal** (`number`) — not `Money` |

### Persistence (DynamoDB)

Flat attributes for round-trip (unchanged wire names in backup):

| Attribute | Maps to |
|-----------|---------|
| `amount_minor` | `canonicalAmount.units` |
| `file_amount_minor` | `fileAmount.units` (optional) |
| `total_amount_minor` | `totalAmount.units` (clusters) |
| `currency` | `Currency` (denormalized; must match account) |

**`amount_scale` is not stored** on new rows — scale comes from **`currency`**. Application types use **`canonicalAmount: Money`** etc.; mappers flatten to `*_minor` on write.

---

## 2. Account-scoped currency (product invariant)

- Each **`ACCOUNT`** has a required, **immutable** **`currency: Currency`**, chosen in the UI **at account creation**.
- Every **`TRANSACTION_FILE`** for that account and every **transaction** created from those imports use the **same** currency.
- **No** import-time resolution chain (prior file → profile default → USD).
- **No** `PATCH` to change file or transaction currency after import.
- Profile **`default_currency`** (optional) is only a **prefill for the create-account dropdown**, not used during import resolution.

### Import validation

| Case | Rule |
|------|------|
| **`account_id`** (existing account) | When client sends **`currency`**, that code is used for file-hint validation and as the import batch currency. When omitted, **`account.currency`** is used. If the parser/file provides a currency hint (e.g. OFX `CURDEF`) and it **≠** the resolved import currency → **`409 Conflict`**. |
| **`new_account_name`** (new account) | Client **must** send **`currency`** (multipart field). If the file provides a hint, it **must match** the chosen currency; otherwise **`409`**. Account is created with that currency before ingest. |

### Error shape (`409 Conflict`)

```json
{
  "error": "currency_mismatch",
  "message": "Import currency does not match this account.",
  "account_currency": "USD",
  "file_currency": "EUR"
}
```

Other bad currency input (invalid ISO code, missing `currency` on new account) may use **`400`** or **`409`** depending on whether the conflict is with account policy vs malformed request — **`currency_mismatch`** is reserved for hint ≠ account.

### Removed behaviour

- `resolveImportCurrency` (file → prior file → profile → USD)
- `PATCH /api/transaction-files/:id` currency override
- `format.currencyChoice` / `user_override` / `prior_account_file` / `profile_default` provenance on files
- Legacy float **`amount`** / **`file_amount`** on Dynamo transaction items (reads/writes)

---

## 3. Aggregations vs individual display

### Dashboard (single-currency rollups)

- User may hold accounts in **multiple** currencies.
- **Never sum** `Money` across currencies.
- Cached metrics are stored **per currency**: **`SK = METRICS#<ISO4217>`** (e.g. `METRICS#USD`, `METRICS#EUR`) — see [`database/data_model.md`](./database/data_model.md) §6.
- **`GET /api/metrics?currency=USD`** returns the snapshot for that currency only (transactions whose account currency matches).
- Dashboard UI: **currency dropdown** populated from **distinct `currency` values on the user’s accounts**; charts and rollups filter to the selection.
- **`refreshStoredDashboardMetrics`** recomputes **every** currency that appears on at least one account after import and after tag-rule application.

### Individual amounts (no global filter)

- Transaction lists, review queue rows, cluster cards, CSV cells, etc. show amounts **in context**.
- Use **`formatAmount(money, currency)`** with **`currency`** from the row or its account — **currency symbol/code always visible** in formatted output.
- No app-wide currency selector on these surfaces.

---

## 4. Transfer pairing

- Amounts in pairing logic use **`Money.units`** (via `canonicalAmount`).
- Default ingest **`epsilonAmount: money(0)`** — exact integer residual.
- Legs on accounts with **different** `currency` do not pair (existing currency guard); **FX conversion is out of scope**.

---

## 5. Rounding

- **`fromMajor`**: half away from zero at `currencyScale(currency)`.
- **`toMajor`**: exact division; wire decimals may show fractional cents only when scale > 0.

---

## 6. Target TypeScript shapes (application)

Illustrative — implement in `@housef4/money` and `db/src/types.ts`:

```typescript
type Currency = string & { readonly __brand: 'Currency' };
type Money = Readonly<{ units: number }>;

interface AccountRecord {
  currency: Currency; // required, immutable
}

interface TransactionRecord {
  canonicalAmount: Money;
  fileAmount?: Money;
  transaction_file_id: string;
  // Currency comes from account via transaction_file_id — not stored on the domain record.
}

interface ImportTransactionInput {
  canonicalAmount: Money;
  fileAmount: Money;
  // Account currency is passed at persist boundaries (importCurrency), not on each row.
}
```

Wire/API **`GET /api/transactions`** still exposes **`amount`** / **`file_amount`** as major-unit **`number`**s plus **`currency`** derived from the parent account (via `transaction_file_id` → `account_id`).

Dynamo **`TRANSACTION`** items may still store **`currency`** as a denormalized copy of **`account.currency`** for backup/legacy reads; domain mappers do not carry it on **`TransactionRecord`**.

---

## 7. Related docs

- [`database/data_model.md`](./database/data_model.md) — `ACCOUNT.currency`, `METRICS#<ccy>`, transaction/cluster currency
- [`api_contract.md`](./api_contract.md) — import multipart `currency`, metrics query param, `409 currency_mismatch`
- [`backup-schema/v1.md`](./backup-schema/v1.md) — backup fields
- [`transfer_matching.md`](./transfer_matching.md) — pairing on minor units
