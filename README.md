# Forge Desk
A personal dashboard for all of my projects and productive working stuff to keep everything in one place and organized.

Electron + React + TypeScript desktop app with a local SQLite database. See [CLAUDE.md](CLAUDE.md) for architecture and roadmap.

## Getting started

Requires Node.js 22.13+ (uses the built-in `node:sqlite`).

```sh
npm install
npm run dev        # launch the app with hot reload
npm run test:db    # smoke-test the shared database layer
npm run test:mcp   # end-to-end test of the MCP server
npm run typecheck
```

## Install as a normal Windows app

```sh
npm run dist
```

Then run `dist\Forge-Desk-Setup-<version>.exe`. It installs for your user only (no admin) and adds a desktop shortcut and a Start menu entry. The installed app uses the same database as `npm run dev` and the MCP server. To update, bump `version` in `package.json`, run `npm run dist` again, and run the new installer over the old one. The installer isn't code-signed, so on first run Windows SmartScreen asks you to confirm (*More info › Run anyway*).

## MCP server (let Claude manage your tasks)

`src/mcp/server.ts` exposes `list_tasks`, `get_task`, `create_task`, `update_task`, `move_task`, `complete_task` and `get_today` over stdio, against the same database as the app. Changes appear in the running app within ~2 seconds.

- **Claude Code:** register it once at user scope so it's available in every repo:
  `claude mcp add --scope user forge-desk -e FORGE_DESK_AGENT=claude-code -- node E:/Coding/Forge_Desk/src/mcp/server.ts`
- **Claude Desktop:** add to `%APPDATA%\Claude\claude_desktop_config.json` and restart the app:

```json
{
  "mcpServers": {
    "forge-desk": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["E:\\Coding\\Forge_Desk\\src\\mcp\\server.ts"]
    }
  }
}
```

Data is stored in `%APPDATA%\ForgeDesk\forge-desk.db` (override with the `FORGE_DESK_DB` environment variable).

## Handing work to Claude Code

0. One-time setup: `npm run install:next-task` (installs `/next-task` for all repos), register the MCP server at user scope (above), and in Forge Desk set the **Repo path** of each project you want Claude Code to work on (select the project, detail panel). The repo needs a `CLAUDE.md` that names its build/test commands.
1. In Forge Desk, set an item's **Assignee** to *Claude Code* and write the spec in its description and notes.
2. In Claude Code, in that project's repo, run `/next-task` (or `/next-task <id>`). It needs a clean working tree.
3. Claude builds the highest-priority item on a `claude/task-<id>-…` branch, runs the tests, commits, writes a report note on the item and sets it to **Review**.
4. Read the note in the detail panel, check the branch, then mark the item done, or add a note and set it back to *To do*.
