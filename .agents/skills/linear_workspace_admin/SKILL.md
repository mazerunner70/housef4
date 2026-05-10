---
name: linear-workspace-admin
description: >-
  Manages day-to-day Linear workspace hygiene and issue/project updates via the
  user-linear MCP (projects, issues, labels, milestones, cycles, comments,
  documents). Use when the user wants to sync Linear with engineering work,
  triage or bulk-update issues, adjust project metadata, or maintain milestones
  and cycles. Not for drafting greenfield roadmaps from raw requirements—use
  linear-tech-lead-planning for that.
---

# Linear workspace admin

## Role

Operate as a disciplined Linear maintainer: read state from Linear, propose minimal correct changes, apply updates through MCP tools, and leave an audit trail (comments or a short summary to the user).

## Before any MCP calls

1. Confirm the **user-linear** MCP is available; if tools are missing, tell the user to enable or authenticate Linear integration.
2. **Read the tool descriptor** for each MCP tool you will call (schema lives under the workspace `mcps/user-linear/tools/` folder). Parameters and semantics change; do not guess required fields.
3. When passing Markdown to Linear (`description`, `content`, comments), send **literal newlines**—do not use escaped `\n` sequences (see Linear MCP server instructions).

## Default workflow

1. **Locate scope**: Use `list_teams`, `list_projects`, and/or `list_issues` with filters (team, project, state, query) to narrow work.
2. **Inspect before edit**: Use `get_issue`, `get_project`, `list_issue_statuses`, `list_cycles`, `list_milestones` as needed so updates match workspace conventions (state names, team IDs).
3. **Apply changes**:
   - **Issues**: `save_issue` — omit `id` to create; include `id` (or identifier like `TEAM-123`) to update. Creating requires `title` and `team`. Use `assignee` (not `assigneeId`). Prefer explicit `state`, `project`, `cycle`, `milestone`, `priority`, `labels` when the user asked for them.
   - **projects**: `save_project` — creating requires `name` and at least one team via `addTeams` or `setTeams`.
   - **Thread context**: `save_comment` when the user wants discussion preserved on the issue.
4. **Destructive or ambiguous ops**: Deleting issues or rewiring large graphs is not always exposed—confirm with the user before relying on side effects. Duplicate detection: check `list_issues` / `get_issue` before creating near-duplicates.

## Behaviors called out by `save_issue`

- **Links**, **blocks**, **blockedBy**, **relatedTo** are **append-only** in the API exposed here; removing relations uses the `remove*` arrays when available.
- Use **Markdown** in descriptions; mention users with `@displayName` when appropriate.

## Quality bar

- Batch edits: show a compact table of planned identifiers and fields changed, then execute.
- After mutations: summarize what changed (issue URLs/identifiers, project name).
- If the user names a team or project ambiguously, disambiguate with `list_teams` / `list_projects` before saving.

## Documentation gaps

Use Linear MCP `search_documentation` when product behavior (states, initiatives, permissions) is unclear rather than inventing rules.
