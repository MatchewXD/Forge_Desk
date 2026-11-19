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

## MCP server (let Claude manage your tasks)

`src/mcp/server.ts` exposes `list_tasks`, `get_task`, `create_task`, `update_task`, `move_task`, `complete_task` and `get_today` over stdio, against the same database as the app. Changes appear in the running app within ~2 seconds.

- **Claude Code:** already registered for this project in `.mcp.json` — approve it when prompted.
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
