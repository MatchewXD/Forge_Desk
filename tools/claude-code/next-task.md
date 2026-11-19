---
description: Pick up the top Forge Desk item assigned to claude-code for THIS repo's project, build it on a new branch, and hand it back for review
argument-hint: "[task id] (optional: work on this item instead of the top one)"
allowed-tools: mcp__forge-desk__list_tasks, mcp__forge-desk__get_task, mcp__forge-desk__list_notes, mcp__forge-desk__update_task, mcp__forge-desk__add_note, mcp__forge-desk__complete_task, Bash(git status:*), Bash(git branch:*), Bash(git checkout:*), Bash(git switch:*), Bash(git add:*), Bash(git commit:*), Bash(git diff:*), Bash(git log:*), Bash(git rev-parse:*), Bash(git symbolic-ref:*), Bash(git show-ref:*)
---

<!--
  User-level command: installed to ~/.claude/commands/next-task.md so it works in every repo.
  Source of truth: Forge Desk repo, tools/claude-code/next-task.md. Reinstall with
  `npm run install:next-task` in that repo after editing.
-->

# /next-task — Forge Desk handoff (any repo)

You are picking up work the user queued for you in Forge Desk (their task board, reached through the
`forge-desk` MCP server). Only work queued for **the project linked to the current repo** counts.
This command is generic: everything repo-specific (stack, conventions, build and test commands) comes
from the current repo's `CLAUDE.md`. Work through the steps in order.

Arguments: `$ARGUMENTS`

## 1. Preflight

- If the `mcp__forge-desk__*` tools aren't available, stop and tell the user to enable the `forge-desk`
  MCP server (`/mcp`), then re-run.
- `git rev-parse --show-toplevel` → the **repo root**. If this isn't a git repo, say so and stop.
- `git status --porcelain`. If there are uncommitted changes, **stop**: list the dirty files and say
  `/next-task` needs a clean working tree. Don't touch Forge Desk.
- Note the current branch (`git rev-parse --abbrev-ref HEAD`); you'll switch back to it at the end.
- Find the **base branch**: `git symbolic-ref --short refs/remotes/origin/HEAD` (strip `origin/`). If
  that fails, use `main` if it exists, else `master` (check with `git show-ref --verify --quiet
  refs/heads/<name>`). If none exists, say so and stop.

## 2. Find this repo's project

- `list_tasks` with `{ "repo_path": "<repo root>" }`. It matches the project whose Repo path is this
  repo (slashes, case and trailing slash are ignored).
- **If nothing matches, say: "No Forge Desk project is linked to this repo (`<repo root>`). Set the
  project's Repo path in Forge Desk to link it." and stop.**

## 3. Pick the item

- If `$ARGUMENTS` contains a task id: `get_task` it. It must be assigned to `claude-code`, have status
  `todo`, and have the project from step 2 among its `ancestors`. Otherwise explain why and stop.
- Otherwise `list_tasks` with `{ "under_id": <project id>, "assignee": "claude-code", "status": "todo" }`
  and choose by:
  1. priority: urgent > high > medium > low
  2. then the earliest `deadline` (items without a deadline come last)
  3. then the lowest `id`
- **If there is no such item, say "No open Forge Desk items are assigned to claude-code in
  <project title>." and stop.** If any claude-code items under the project are `in_progress` or
  `blocked`, list them (id, title, status) so the user can decide, but don't pick them up.

## 4. Read the spec and the repo's instructions

- `get_task` for the chosen id. The **description plus all notes (oldest first)** are the spec. Later
  notes override earlier ones. Use the `ancestors` for context and the children (micro-tasks) as a
  checklist. Done children are already finished.
- Read `<repo root>/CLAUDE.md`.
  - **If it doesn't exist:** `add_note` "Blocked: this repo (`<repo root>`) has no CLAUDE.md, so I
    don't know its build and test commands and won't guess. Add a CLAUDE.md (stack, conventions,
    build/test commands), then set this back to todo." Then `update_task` status `blocked`, tell the
    user, and stop. Don't create a branch.
  - From CLAUDE.md, note the **verification commands** (build, test, typecheck, lint, …). If it names
    none and doesn't say the repo has none, treat it the same as a missing CLAUDE.md (note it, set
    `blocked`, stop). Never invent commands.
- If the spec is too ambiguous to implement safely, don't guess on anything significant: `add_note`
  with your specific questions, `update_task` status `blocked`, report to the user, and stop.

## 5. Claim it

- `update_task` → `{ "status": "in_progress" }`.
- `git switch <base branch>`, then `git switch -c claude/task-<id>-<short-kebab-slug-of-title>`.
- `add_note`: "Started by Claude Code on branch `<branch>` in `<repo root>`."

## 6. Implement

- Build what the spec asks for, no more, following CLAUDE.md's stack and conventions.
- Add or extend tests where the change has logic, in the style the repo already uses.
- Update CLAUDE.md if you change the architecture, data model, tools, or commands.
- If the item has micro-task children, complete each one you finish with `complete_task`.

## 7. Verify

Run **every verification command from CLAUDE.md** and make them pass. If something still fails after
a genuine attempt to fix it, commit the work in progress anyway (step 8), then in step 9 set the status
to `blocked` instead of `review`, and put the failing command and the relevant output in the note.

## 8. Commit

- `git add` only the files you changed (never `.env`, local settings, databases or build output), then
  commit on the task branch with a message like `Forge #<id>: <title>` plus a short body.
- Don't push and don't merge. The user reviews first.
- Record the short commit hash (`git rev-parse --short HEAD`).

## 9. Hand back

`add_note` with a report in this shape (Markdown):

```
## Done: <title>
**Repo:** `<repo root>` · **Branch:** `<branch>` · **Commit:** `<hash>`

### What was built
- …

### How to test
1. `git switch <branch>`
2. … (concrete steps that show the feature working, using the repo's own run commands)
- Automated: <each verification command from CLAUDE.md>: passing (or which failed and why)

### Needs your attention
- Decisions or assumptions you made, follow-ups, anything the user must do (merge, migrate data,
  approve a dependency, …), or "Nothing."
```

Then `update_task` → `{ "status": "review" }` (or `blocked` if verification failed), and finish by
telling the user, briefly: the item, the branch and commit, the verification results, and that it's
waiting in Forge Desk for their review. Finally switch back to the branch you started on (the work is
safe on the task branch), so the user's checkout is unchanged.
