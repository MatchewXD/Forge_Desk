import type { DatabaseSync } from 'node:sqlite'

// Append-only list of migrations. PRAGMA user_version records how many have run.
// Never edit a migration once it has shipped — add a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    level         TEXT NOT NULL CHECK (level IN ('vision','project','milestone','task','microtask')),
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','done')),
    deadline      TEXT,
    priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    completed_at  TEXT
  );
  CREATE INDEX idx_tasks_parent   ON tasks(parent_id, sort_order);
  CREATE INDEX idx_tasks_deadline ON tasks(deadline) WHERE deadline IS NOT NULL;
  `,
  // 2: recurring tasks + completion log for their occurrences
  `
  ALTER TABLE tasks ADD COLUMN recurrence TEXT
    CHECK (recurrence IS NULL OR recurrence IN ('daily','weekdays','weekly'));
  CREATE TABLE task_completions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    occurrence_date  TEXT,
    completed_at     TEXT NOT NULL
  );
  CREATE INDEX idx_completions_task ON task_completions(task_id, completed_at);
  `
]

export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  let version = row.user_version
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(MIGRATIONS[version])
      version++
      db.exec(`PRAGMA user_version = ${version}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length
