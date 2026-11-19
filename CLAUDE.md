# Forge Desk

A personal Windows desktop app for managing all of my projects in one place: long-term visions broken down into projects, milestones, tasks and micro-tasks, with a daily "Today" view of what is due. Later phases add board/timeline views, an AI asset library, and an MCP server so Claude can manage the task board directly.

## Tech stack

- **Electron** (main + preload + renderer, `contextIsolation` on, no `nodeIntegration` in the renderer)
- **React 19 + TypeScript** in the renderer, plain CSS with CSS variables (dark theme)
- **electron-vite** for dev server / bundling (`electron.vite.config.ts`)
- **SQLite via the built-in `node:sqlite` module** (`DatabaseSync`). No native npm modules: the same DB code runs in Electron's main process *and* in a plain Node (>= 22.13) process such as the MCP server, with no ABI rebuilds.

## Commands

- `npm run dev` — start the app with hot reload
- `npm run build` — production bundle into `out/`
- `npm run typecheck` — type-check main/preload/shared and renderer
- `npm run test:db` — smoke-test the shared DB layer in plain Node against a temp database
- `npm run test:mcp` — end-to-end test of the MCP server over stdio (spawns it, calls every tool) against a temp database
- `npm run mcp` — run the MCP server on stdio (normally launched by Claude, not by hand)

## Layout

```
src/
  shared/db/        Shared database module — NO Electron or React imports allowed
    model.ts        Types + constants (levels, statuses, priorities). Renderer-safe.
    dates.ts        Local-date helpers (YYYY-MM-DD). Renderer-safe.
    schema.ts       Migrations, keyed off PRAGMA user_version
    connection.ts   openDatabase(), defaultDbPath() (WAL + busy_timeout for multi-process use)
    repository.ts   TaskRepository: all reads/writes and business rules
    index.ts        Public entry point (Node-only: pulls in node:sqlite)
  mcp/server.ts     MCP server (stdio). Seven tools, each a thin wrapper over TaskRepository
  main/             Electron main process: window, IPC handlers -> TaskRepository, external-change watcher
  preload/          contextBridge exposing a typed `window.forge` API
  renderer/         React UI (sidebar, Tasks tree, Today screen, detail panel)
scripts/            Node scripts (e.g. db-smoke.ts) run directly with Node's type stripping
```

## Conventions

- **All business rules live in `TaskRepository`**, never in IPC handlers or UI. The app and the MCP server must behave identically, so anything both need goes in `src/shared/db`.
- `src/shared/db` uses only erasable TypeScript (no enums, no parameter properties, no namespaces) and `.ts` extensions on relative imports, so it runs directly under `node` with type stripping as well as through Vite.
- The renderer may import **only** `model.ts` and `dates.ts` from shared (types/pure helpers). Never import `index.ts`/`repository.ts` into renderer code.
- Deadlines are local calendar dates stored as `YYYY-MM-DD` text. Timestamps (`created_at`, etc.) are ISO strings.
- Schema changes: append a new migration to `schema.ts`; never edit a shipped one.

## Data model

Single `tasks` table, self-referencing via `parent_id` (cascade delete).

| Level | Index | Parent must be |
|---|---|---|
| vision | 0 | none (root) |
| project | 1 | vision |
| milestone | 2 | project |
| task | 3 | milestone |
| microtask | 4 | task (leaf; cannot have children) |

Every item has: `title`, `description`, `status` (`todo` / `in_progress` / `blocked` / `done`), `deadline` (nullable date), `priority` (`low` / `medium` / `high` / `urgent`), plus `sort_order`, `created_at`, `updated_at`, `completed_at`.

**Progress roll-up:** a leaf is 100% if `done`, else 0%. A parent's progress is the average of its children's progress (recursively). Computed in `repository.ts` (`getTree`) so every client sees the same numbers.

**Database location:** `%APPDATA%\ForgeDesk\forge-desk.db` by default; override with the `FORGE_DESK_DB` environment variable (use this for tests and for pointing the MCP server at the same file).

## Roadmap

### Phase 1 — Task hierarchy + Today screen (done)
- Dark-themed app shell with sidebar navigation
- Nested Vision → Project → Milestone → Task → Micro-task hierarchy with title, description, status, deadline, priority
- Collapsible tree view with progress bars rolled up from children; create / edit / move / delete / complete
- Today screen: overdue, due today, and next 7 days (excluding done items)

### Phase 1.5 — MCP server (done)
A stdio MCP server (`src/mcp/server.ts`, `@modelcontextprotocol/sdk` + `zod`) so Claude can manage the task board. It imports `src/shared/db` and opens the **same SQLite file** as the app (`%APPDATA%\ForgeDesk\forge-desk.db`, or `FORGE_DESK_DB`).

Tools (thin wrappers over `TaskRepository` — no logic of their own; tool args are snake_case):
- `list_tasks` — flat list filtered by parent_id / level / status / due_before / include_done, or `tree: true` (optionally `root_id`) for the nested tree with progress
- `get_task` — one item with progress, its ancestors and its subtree (`repo.getTaskDetail`)
- `create_task` — title, parent_id, level, description, status, deadline, priority
- `update_task` — patch title / description / status / deadline / priority
- `move_task` — new_parent_id and/or index (validated against level rules)
- `complete_task` — mark done, optionally `cascade` to descendants
- `get_today` — overdue / due today / next N days (same query as the Today screen)

How it fits together:
- Runs as TypeScript directly (`node src/mcp/server.ts`, Node >= 22.18 type stripping) — no build step. `src/mcp/package.json` marks it ESM.
- stdout is the MCP channel: the server must only log to **stderr**.
- DB is in WAL mode with `busy_timeout`, so the app and the server can write concurrently. The app polls `PRAGMA data_version` and refreshes when the server writes, so Claude's edits show up live.
- New tool? Put the logic in `TaskRepository` first, then add a wrapper here, and cover it in `scripts/mcp-smoke.ts`.

Registration:
- Claude Code: project-scoped in `.mcp.json` (`claude mcp add --scope project forge-desk -- node E:/Coding/Forge_Desk/src/mcp/server.ts`).
- Claude Desktop: add to `%APPDATA%\Claude\claude_desktop_config.json`:
  ```json
  { "mcpServers": { "forge-desk": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["E:\\Coding\\Forge_Desk\\src\\mcp\\server.ts"] } } }
  ```

### Phase 2 — Kanban + timeline views (planned)
- Kanban board grouped by status, filterable by vision/project, drag to change status
- Timeline (Gantt-style) view of deadlines across milestones and tasks

### Phase 3 — AI asset library (planned)
- Library of AI-related assets (prompts, generated images, model outputs, reference files) linked to projects/tasks, with tagging and search
