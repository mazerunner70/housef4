---
title: Backup & restore — manual QA checklist
stage: Detailed Design
related:
  - ./api_contract.md
  - ./backend_dev_and_prod_environments.md
  - ./database/data_model.md
---

# Backup & restore — manual QA checklist

Companion to **[`api_contract.md`](./api_contract.md) §6** and **[`backend_dev_and_prod_environments.md`](./backend_dev_and_prod_environments.md)**. Use **`/settings/data`** in the SPA for typical flows (**Settings → Your data**) or **`curl`/HTTP tooling** where noted.

Document **pass/fail**, **environment** (local / staging / prod), **approximate timestamp**, and any **screenshots or logs** useful for regressions.

## Prerequisites

1. **`DYNAMODB_TABLE_NAME`** and **`DYNAMODB_RESTORE_STAGING_TABLE_NAME`** both set whenever restore is exercised (**Lambda** Terraform: `infrastructure/lambda_api.tf`; **local**: shell or `.env.local` — see root [`README`](../../../README.md) and **`backend_dev_and_prod_environments.md` §5).
2. **Authenticated user:** real Cognito JWT (deployed UI) **or** `APP_ENV=local` with **`DEV_AUTH_USER_ID`** as documented locally.
3. After any **successful** restore, **reload the SPA** so React Query/state matches the replaced partition (**API contract §6** client obligations).

---

## Scenario 1 — Export → restore round-trip

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create or note representative data (accounts, a few transactions, optional import/file metadata consistent with MVP). | Baseline identifiable in UI. |
| 2 | On **`/settings/data`**, download a backup (**GET `/api/backup/export`**). | **`200`**; saved JSON conforms to **`backup-schema/v1`** (see [`backup-schema/README.md`](./backup-schema/README.md)). |
| 3 | Change visible data **or** wipe something you can recognise (still same user session). | Data differs from step 2 snapshot. |
| 4 | Restore the JSON from step 2 via the wizard (**POST `/api/backup/restore`**, multipart part **`backup`**). **`success`** in body. | UI shows success counts; refreshed app matches the backup’s contents (no merge behaviour). |

---

## Scenario 2 — Wrong backup → **403**

| Step | Action | Expected |
|------|--------|----------|
| 1 | **User A** exports a backup. | Valid file for A. |
| 2 | **User B** (different `app_user_id` / Cognito sub) attempts to restore A’s file (same browser profile with B logged in, or upload from B’s session). | **`403`** — backup identity does not match authenticated user; **no** partial primary overwrite. |

*Tip:* Tampering `app_user_id` inside the JSON to another user’s id should also yield **`403`** when that id does not match the session.

---

## Scenario 3 — Concurrent restore → **409**

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start a restore with a large enough backup that it runs for several seconds **or** use two parallel **`POST /api/backup/restore`** calls (same user, **`Authorization`** on both). | Second request returns **`409`** while **`RESTORE_LOCK`** (**`SYSTEM#RESTORE_LOCK`**) exists on the primary table — see **`data_model.md`** §8.2a. |
| 2 | After the **first** restore completes successfully, optionally repeat two overlapping calls. | Behaviour still consistent with single-flight semantics (no conflicting primaries). |

---

## Scenario 4 — Abort after failure (stuck restore)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Force a restore failure that leaves **`RESTORE_LOCK`** (e.g. server **`500`** mid-workflow, or integration test harness). | User remains blocked from a **new** restore by **`409`** until cleanup. |
| 2 | Call **`POST /api/backup/restore/abort`** (SPA **“Clear restore lock”** on the stuck banner, or **`curl`**). **`200`** with **`restore_lock_cleared`**: **`true`** and **`staging_partition_cleared`**: **`true`** when cleanup completes. | Lock removed **first**, then staging partition cleared (**contract order** §6 **Abort restore**). |
| 3 | Reload / retry **`POST /api/backup/restore`**. | **`409`** no longer persists solely because of the earlier failed run (**new** restore allowed). |

*Note:* Abort **does not** cancel an **in-flight** Lambda; product stance is to use it **after** failure, timeout, or stalled UI (**`api_contract.md`** §6).

---

## Scenario 5 — Abort **retry** after partial **`500`**

Simulate or observe **abort** returning **`500`** **after** the lock was deleted but staging cleanup incomplete (throttle / timeout during partition deletes).

| Step | Action | Expected |
|------|--------|----------|
| 1 | Inspect response JSON if present: **`success`**: **`false`**, **`restore_lock_cleared`**: **`true`**, **`staging_partition_cleared`**: **`false`**. | Matches **partial failure** contract (**`api_contract.md`** §6). |
| 2 | Retry **`POST /api/backup/restore/abort`** until **`200`** with **`staging_partition_cleared`**: **`true`**. | Idempotent retries; **`409`** is **not** reintroduced solely because **`restore_lock_cleared`** was already **`true`**. |
| 3 | Run a fresh **`POST /api/backup/restore`** after staging is drained. | Succeeds per normal staging workflow (next restore also clears staging before write — **`data_model.md`** §8.2). |

The SPA **`postBackupRestoreAbortWithRetries`** (`frontend/src/api/client.ts`) aligns with retrying **`500`**; verify behaviour matches backend responses.
