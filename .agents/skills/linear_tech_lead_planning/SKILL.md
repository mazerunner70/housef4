---
name: linear-tech-lead-planning
description: >-
  Tech-lead workflow for a new Linear project: refines requirements into an
  actionable story backlog, presents it for human review, creates or updates the
  Linear project and issues via user-linear MCP after approval, and writes a
  concise summary document (repo markdown and optionally a Linear project
  document). Use when starting a new initiative in Linear, breaking a PRD or
  brief into stories, or planning a milestone-shaped body of work to execute in
  Linear.
---

# Linear tech lead planning

## Role

Act as a tech lead: translate fuzzy requirements into **small, shippable stories** with clear acceptance signals, get explicit **human approval** before writing to Linear, then sync Linear and produce a **single summary artifact** the team can reference.

## Inputs to gather (ask if missing)

- Problem / outcome and constraints (time, compliance, platforms).
- **Team** (Linear team name) that will own the work.
- Whether to **create a new Linear project** or attach stories to an existing one (name or slug).
- Optional: priority, target dates, labels to standardize on, epic structure preference (flat vs parent epic issues).

## Before MCP calls

1. Confirm **user-linear** MCP is available; read each tool’s JSON schema under workspace `mcps/user-linear/tools/` before invoking.
2. Markdown fields (`description`, document `content`) must use **real newlines**, not `\n` escape sequences.

## Story breakdown rules

- Prefer **vertical slices** over horizontal layers (each story should deliver observable value or a verified milestone).
- Titles: imperative, specific, under ~80 characters.
- Description template (Markdown):

  ```markdown
  ## Context
  ...

  ## Acceptance criteria
  - [ ] ...

  ## Notes / out of scope
  ...
  ```

- Size: aim for stories one engineer can finish within a few days; split monsters.
- Dependencies: note natural ordering; use `blocks` / `blockedBy` in Linear only when the user confirms that modeling—remember append-only relation behavior on create/update.
- Optional: suggest **labels** and **priority**; leave `assignee` unset unless the user names owners.

## Review gate (mandatory)

1. Present a **review packet** in chat:
   - Proposed **project** line: name, one-line summary, optional description bullet list.
   - **Story table**: `#`, title, type (feature/chore/spike/docs), priority suggestion, notes (deps, risk).
2. **Do not** call `save_project` or `save_issue` until the user explicitly approves or edits the packet (“approved”, “LGTM”, or equivalent).
3. Incorporate feedback; re-show only the delta if changes are small.

## Execution order after approval

1. **Resolve entities**: `list_teams` (and `list_projects` if attaching to an existing project) to pin correct names/IDs.
2. **Project**: `save_project` — create requires `name` and `addTeams` or `setTeams`. Populate `summary` (≤255 chars) and `description` from the approved charter.
3. **Issues**: For each approved story, `save_issue` with `team`, `title`, `description`, `project`, and optional `priority`, `labels`, `state`, `milestone`, `cycle`.
   - If using an epic + children: create parent issue first, then children with `parentId` set to parent identifier.
4. **Identifiers**: Collect returned issue identifiers and Linear URLs from tool results if provided; include them in the summary doc.

## Summary document (required artifact)

Create **one** markdown file in the repo at a path the user chooses; if they do not specify, default to:

`docs/01_discovery/linear/<short-project-slug>.md`

Use this structure:

```markdown
# <Project name>

## Purpose
2–4 sentences.

## Linear links
- Project: ...
- Team: ...

## Story backlog summary
| ID | Title | Notes |
|----|-------|-------|
| … | … | … |

## Risks / assumptions
- ...

## Out of scope
- ...
```

**Optional**: Mirror the same content (or a shortened version) into Linear with `save_document`: `title` + `content`, with `project` set to the new/existing project—only after the user agrees duplicating into Linear.

## Handoff

End with: project status in Linear, path to the repo summary doc, and any follow-ups left intentionally unfiled.
