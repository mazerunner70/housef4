---
title: Backup artifact schema (versioned)
stage: Detailed Design
phase: Backup & restore
---

# Backup artifact schema

Portable backup files are **JSON artifacts** produced by **`GET /api/backup/export`** and consumed by **`POST /api/backup/restore`**. They are not DynamoDB rows.

| Doc | Status | `backup_schema_version` |
|-----|--------|-------------------------|
| [v1.md](./v1.md) | **Current (implemented)** | **`1`** |

**Related (not versioned here):** restore staging workflow, lock row, and DynamoDB key layout remain in [`../database/data_model.md`](../database/data_model.md) §8. **HTTP behaviour** (status codes, headers) is in [`../api_contract.md`](../api_contract.md) §6.

## Adding a new version

When the on-disk JSON shape changes incompatibly:

1. Add **`docs/03_detailed_design/backup-schema/vN.md`** with a full field dictionary, migration notes from **vN−1**, and which server versions read/write it.
2. Bump the constant in code (e.g. `BACKUP_SCHEMA_VERSION_VN` in [`db/src/types.ts`](../../../db/src/types.ts)); implement export and restore acceptance per contract.
3. Update this table and cross-links in [`api_contract.md`](../api_contract.md) / [`data_model.md`](../database/data_model.md) if the envelope rules change.

Until a version is documented here and implemented, treat it as **unsupported**.
