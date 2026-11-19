// Public entry point of the shared database module (Node-only: depends on node:sqlite).
// Used by the Electron main process and the (Phase 1.5) MCP server.
export * from './model.ts'
export * from './dates.ts'
export { openDatabase, defaultDbPath, dataVersion } from './connection.ts'
export { SCHEMA_VERSION } from './schema.ts'
export { TaskRepository, TaskError } from './repository.ts'
