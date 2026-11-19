# Forge Desk
A personal dashboard for all of my projects and productive working stuff to keep everything in one place and organized.

Electron + React + TypeScript desktop app with a local SQLite database. See [CLAUDE.md](CLAUDE.md) for architecture and roadmap.

## Getting started

Requires Node.js 22.13+ (uses the built-in `node:sqlite`).

```sh
npm install
npm run dev        # launch the app with hot reload
npm run test:db    # smoke-test the shared database layer
npm run typecheck
```

Data is stored in `%APPDATA%\ForgeDesk\forge-desk.db` (override with the `FORGE_DESK_DB` environment variable).
