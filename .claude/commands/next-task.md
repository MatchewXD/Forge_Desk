---
description: Pick up the top Forge Desk item assigned to claude-code, build it on a new branch, and hand it back for review
argument-hint: "[task id] (optional: work on this item instead of the top one)"
allowed-tools: mcp__forge-desk__list_tasks, mcp__forge-desk__get_task, mcp__forge-desk__list_notes, mcp__forge-desk__update_task, mcp__forge-desk__add_note, mcp__forge-desk__complete_task, Bash(git status:*), Bash(git branch:*), Bash(git checkout:*), Bash(git switch:*), Bash(git add:*), Bash(git commit:*), Bash(git diff:*), Bash(git log:*), Bash(git rev-parse:*), Bash(npm run:*), Bash(npm test:*)
---

# /next-task — Forge Desk handoff

You are picking up work the user queued for you in Forge Desk (their task board, reached through the
`forge-desk` MCP server). Work through the steps below in order. Read and follow `CLAUDE.md` for the
project's stack and conventions.

Arguments: `$ARGUMENTS`

## 1. Preflight

- Run `git status --porcelain`. If there are uncommitted changes, **stop**: tell the user which files are
  dirty and that `/next-task` needs a clean working tree. Don't touch Forge Desk.
- Note the current branch (`git rev-parse --abbrev-ref HEAD`); you will branch from `main`.
- If the `mcp__forge-desk__*` tools aren't available, stop and tell the user to approve or enable the
  `forge-desk` MCP server (`/mcp`), then re-run.

## 2. Pick the item

- If `$ARGUMENTS` contains a task id, use that item. It must be assigned to `claude-code` and have status
  `todo`; otherwise explain why and stop.
- Otherwise call `list_tasks` with `{ "assignee": "claude-code", "status": "todo" }` and choose by:
  1. priority: urgent > high > medium > low
  2. then the earliest `deadline` (items without a deadline come last)
  3. then the lowest `id`
- **If there is no such item, say "No open Forge Desk items are assigned to claude-code." and stop.** If
  any claude-code items are `in_progress` or `blocked`, list them (id, title, status) so the user can
  decide, but don't pick them up.

## 3. Read the spec

- Call `get_task` for the chosen id. The **description plus all notes (oldest first)** are the spec.
  Later notes override earlier ones. Use the `ancestors` (vision > project > milestone) for context
  and the children (micro-tasks) as a checklist. Done children are already finished.
- If the spec is too ambiguous to implement safely, don't guess on anything significant:
  `add_note` with your specific questions, `update_task` status `blocked`, report to the user, and stop.

## 4. Claim it

- `update_task` → `{ "status": "in_progress" }`.
- Create the branch from up-to-date `main`: `git switch main`, then
  `git switch -c claude/task-<id>-<short-kebab-slug-of-title>`.
- `add_note`: "Started by Claude Code on branch `<branch>`."

## 5. Implement

- Build what the spec asks for, no more. Follow CLAUDE.md, and put business rules in
  `src/shared/db/repository.ts` (the app and the MCP server share it).
- Add or extend tests where the change has logic: `scripts/db-smoke.ts` for repository rules,
  `scripts/mcp-smoke.ts` for MCP tools.
- Update CLAUDE.md if you change the architecture, data model, tools, or commands.
- If the item has micro-task children, complete each one you finish with `complete_task`.

## 6. Verify

Run all of these and make them pass:

```
npm run typecheck
npm run test:db
npm run test:mcp
npm run build
```

If something still fails after a genuine attempt to fix it, commit the work in progress anyway (step 7),
then in step 8 set the status to `blocked` instead of `review`, and put the failing command and the
relevant output in the note.

## 7. Commit

- `git add` only the files you changed (never `.env`, local settings, or databases), then commit on the
  task branch with a message like `Forge #<id>: <title>` plus a short body.
- Don't push and don't merge. The user reviews first.
- Record the short commit hash (`git rev-parse --short HEAD`).

## 8. Hand back

`add_note` with a report in this shape (Markdown):

```
## Done: <title>
**Branch:** `<branch>` · **Commit:** `<hash>`

### What was built
- …

### How to test
1. `git switch <branch>`
2. `npm run dev`, then … (concrete clicks or MCP calls that show the feature working)
- Automated: typecheck, test:db, test:mcp, build: all passing (or which failed and why)

### Needs your attention
- Decisions or assumptions you made, follow-ups, anything the user must do (merge, migrate data,
  approve a dependency, …), or "Nothing."
```

Then `update_task` → `{ "status": "review" }` (or `blocked` if verification failed), and finish by
telling the user, briefly: the item, the branch and commit, the test results, and that it's waiting in
Forge Desk for their review. Finally switch back to the branch you started on (the work is safe on the
task branch), so the user's checkout is unchanged.
