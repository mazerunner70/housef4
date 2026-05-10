# Agent instructions — housef4

Use this file as default project context. Prefer **small, scoped changes** and match existing patterns in the touched package.

## Monorepo layout

| Path | Role |
|------|------|
| `frontend/` | React + Vite SPA |
| `backend/` | Node.js TypeScript Lambda HTTP handlers |
| `db/` | DynamoDB repository layer (single-table access patterns) |
| `infrastructure/` | Terraform for AWS |
| `scripts/` | Bash helpers (local bootstrap, deploy, auth smoke tests) |
| `docs/` | Product and technical documentation (see `docs/README.md`) |

Package manager: **pnpm** workspaces (`pnpm install` at repo root).

## Commands (root `package.json`)

- **Dev / build / test:** `pnpm dev`, `pnpm build`, `pnpm test`
- **Local stack:** `pnpm run build-deploy:local` (or `build-deploy:local:fresh`)
- **Prod-style builds:** `pnpm run build:prod`, `pnpm run build-deploy:prod`

Use package-level scripts via `pnpm --filter <package>` when working only in one workspace.

## Documentation contracts

Start from **`docs/README.md`** for the map of detailed design docs.

When changing HTTP surfaces or client expectations, update **`docs/03_detailed_design/api_contract.md`** in the same change.

When changing DynamoDB keys, GSIs, or stored attributes, update **`docs/03_detailed_design/database/data_model.md`** together with **`db/`** and **`infrastructure/`** as applicable.

Backup/export/restore behavior is documented in **`docs/03_detailed_design/backup_restore_manual_qa.md`** and **`docs/03_detailed_design/api_contract.md`** (backup sections); staging table env vars are summarized in root **`README.md`**.

## Domain agent skills (pull in with `@`)

Specialized playbooks live under **`.agents/skills/*/SKILL.md`**:

- **`design_architect`** — documentation stages and keeping design docs aligned with code and infra
- **`backend_expert`** — `backend/` API and handler conventions
- **`frontend_expert`** — `frontend/` UI patterns
- **`db_admin`** — persistence modeling and `db/`
- **`infra_engineer`** — Terraform and **`infrastructure/`**
- **`personal_finances_expert`** — product/domain priorities for personal finance flows
- **`transaction_analysis_expert`** — imports, clustering, categorization pipelines
- **`linear_workspace_admin`** — Linear workspace upkeep via MCP (issues, projects, triage)
- **`linear_tech_lead_planning`** — break requirements into Linear stories (review gate before writes), plus a repo summary doc

Invoke the skill path explicitly when the task matches its scope.

## MCP / external tools

If **user-linear** MCP tools are enabled, read each tool’s schema under the Cursor MCP descriptors before calling. For Linear Markdown fields, use **literal newlines**, not escaped `\n`.

## Working style

- Read neighboring code before editing; reuse existing helpers and naming.
- Do not refactor unrelated files or expand scope beyond the request.
- Run targeted tests or builds for packages you change when practical (`pnpm --filter @housef4/<pkg> run …`).
