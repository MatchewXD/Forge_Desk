import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { migrate } from './schema.ts'

/**
 * Default database location, shared by the app and the MCP server.
 * Override with FORGE_DESK_DB (absolute path, or ':memory:').
 */
export function defaultDbPath(): string {
  const override = process.env.FORGE_DESK_DB
  if (override) return override
  const base = process.env.APPDATA ?? join(homedir(), '.config')
  return join(base, 'ForgeDesk', 'forge-desk.db')
}

/** Open (creating if needed) and migrate the database. Safe for multiple processes. */
export function openDatabase(path: string = defaultDbPath()): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  // WAL lets the app and the MCP server read/write the same file concurrently;
  // busy_timeout makes a writer wait briefly instead of failing with SQLITE_BUSY.
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA synchronous = NORMAL')
  migrate(db)
  return db
}

/** Changes whenever *another* connection commits. Used to detect external edits. */
export function dataVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version
}
