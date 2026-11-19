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
    `,
  // 3: assignee + 'review' status + append-only notes.
  // SQLite can't alter a CHECK constraint, so tasks is rebuilt (foreign keys are off while
  // migrations run — see migrate() — so dropping the old table doesn't cascade).
  `
  CREATE TABLE tasks_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    level         TEXT NOT NULL CHECK (level IN ('vision','project','milestone','task','microtask')),
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'todo'
                  CHECK (status IN ('todo','in_progress','blocked','review','done')),
    deadline      TEXT,
    priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    completed_at  TEXT,
    recurrence    TEXT CHECK (recurrence IS NULL OR recurrence IN ('daily','weekdays','weekly')),
    assignee      TEXT NOT NULL DEFAULT 'me' CHECK (assignee IN ('me','claude-code','claude'))
  );
  INSERT INTO tasks_new (id, parent_id, level, title, description, status, deadline, priority,
                         sort_order, created_at, updated_at, completed_at, recurrence)
    SELECT id, parent_id, level, title, description, status, deadline, priority,
           sort_order, created_at, updated_at, completed_at, recurrence FROM tasks;
  DROP TABLE tasks;
  ALTER TABLE tasks_new RENAME TO tasks;
  CREATE INDEX idx_tasks_parent   ON tasks(parent_id, sort_order);
  CREATE INDEX idx_tasks_deadline ON tasks(deadline) WHERE deadline IS NOT NULL;
  CREATE INDEX idx_tasks_assignee ON tasks(assignee, status);

  CREATE TABLE task_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    author      TEXT NOT NULL CHECK (author IN ('me','claude-code','claude')),
    text        TEXT NOT NULL CHECK (length(trim(text)) > 0)
  );
  CREATE INDEX idx_notes_task ON task_notes(task_id, id);
  -- Append-only: no edits; deletes only via the cascade when the item itself is deleted.
  CREATE TRIGGER task_notes_no_update BEFORE UPDATE ON task_notes
  BEGIN SELECT RAISE(ABORT, 'Notes are append-only'); END;
  CREATE TRIGGER task_notes_no_delete BEFORE DELETE ON task_notes
  WHEN EXISTS (SELECT 1 FROM tasks WHERE id = OLD.task_id)
  BEGIN SELECT RAISE(ABORT, 'Notes are append-only'); END;
  `,
  // 4: local git repo of a project, so /next-task can find "this repo's" work.
  `
  ALTER TABLE tasks ADD COLUMN repo_path TEXT;
  `
]

/**
 * Runs pending migrations, each in its own transaction. Foreign keys are switched off while
 * they run (the PRAGMA is a no-op inside a transaction, so it's set outside) so a migration can
 * rebuild a table, and each one must pass foreign_key_check before it commits.
 */
export function migrate(db: DatabaseSync): void {
  const userVersion = (): number =>
    (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (userVersion() >= MIGRATIONS.length) return
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    for (;;) {
      db.exec('BEGIN IMMEDIATE')
      try {
        // Re-read under the write lock: the app and the MCP server may start together.
        let version = userVersion()
        if (version >= MIGRATIONS.length) {
          db.exec('COMMIT')
          break
        }
        db.exec(MIGRATIONS[version])
        const broken = db.prepare('PRAGMA foreign_key_check').all()
        if (broken.length) throw new Error(`Migration ${version + 1} broke foreign keys: ${JSON.stringify(broken)}`)
        version++
        db.exec(`PRAGMA user_version = ${version}`)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length
