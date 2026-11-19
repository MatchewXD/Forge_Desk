// Smoke test for the shared DB layer, run in plain Node (no Electron):
//   npm run test:db
// Exercises the same code path the Phase 1.5 MCP server will use.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskRepository, openDatabase, addDays, toLocalDateString } from '../src/shared/db/index.ts'

const dir = mkdtempSync(join(tmpdir(), 'forge-desk-'))
const dbPath = join(dir, 'test.db')

try {
  const db = openDatabase(dbPath)
  const repo = new TaskRepository(db)
  const today = toLocalDateString()

  const vision = repo.createTask({ title: 'Ship indie games' })
  assert.equal(vision.level, 'vision')
  const project = repo.createTask({ parentId: vision.id, title: 'Game #1' })
  assert.equal(project.level, 'project')
  const ms = repo.createTask({ parentId: project.id, title: 'Prototype', deadline: addDays(today, 3) })
  const t1 = repo.createTask({ parentId: ms.id, title: 'Movement', deadline: today, priority: 'high' })
  const t2 = repo.createTask({ parentId: ms.id, title: 'Combat', deadline: addDays(today, -2) })
  const m1 = repo.createTask({ parentId: t2.id, title: 'Hitboxes' })
  const m2 = repo.createTask({ parentId: t2.id, title: 'Damage numbers' })
  assert.equal(m1.level, 'microtask')

  // Level rules
  assert.throws(() => repo.createTask({ parentId: m1.id, title: 'too deep' }), /cannot have children/)
  assert.throws(() => repo.createTask({ title: 'orphan', level: 'task' }), /must have a parent/)
  assert.throws(() => repo.moveTask(t1.id, project.id), /only be moved under a milestone/)
  assert.throws(() => repo.updateTask(t1.id, { deadline: '2026-02-30' }), /Invalid deadline/)

  // Progress roll-up: t1 leaf (0), t2 has 2 microtasks
  repo.completeTask(m1.id)
  let [root] = repo.getTree()
  const t2Node = root.children[0].children[0].children[1]
  assert.equal(t2Node.progress, 0.5)
  assert.equal(root.progress, 0.25) // milestone = avg(0, 0.5)
  assert.equal(root.leafCount, 3)
  assert.equal(root.leafDone, 1)

  // Cascade complete
  repo.completeTask(t2.id, { cascade: true })
  assert.equal(repo.getTask(m2.id)!.status, 'done')
  ;[root] = repo.getTree()
  assert.equal(root.progress, 0.5)

  // Status change back to todo clears completed_at
  const reopened = repo.updateTask(m2.id, { status: 'todo' })
  assert.equal(reopened.completedAt, null)

  // Move + ordering
  const ms2 = repo.createTask({ parentId: project.id, title: 'Polish' })
  repo.moveTask(t1.id, ms2.id)
  assert.equal(repo.getTask(t1.id)!.parentId, ms2.id)
  const t3 = repo.createTask({ parentId: ms2.id, title: 'Juice' })
  repo.moveTask(t3.id, ms2.id, 0)
  assert.deepEqual(
    repo.listTasks({ parentId: ms2.id }).map((t) => t.title),
    ['Juice', 'Movement']
  )

  // Today view
  repo.updateTask(t2.id, { status: 'in_progress' })
  const view = repo.getToday(today)
  assert.deepEqual(view.overdue.map((t) => t.title), ['Combat'])
  assert.deepEqual(view.dueToday.map((t) => t.title), ['Movement'])
  assert.deepEqual(view.upcoming.map((t) => t.title), ['Prototype'])
  assert.deepEqual(view.dueToday[0].path, ['Ship indie games', 'Game #1', 'Polish'])

  // A second connection (as the MCP server would be) sees the same data
  const otherDb = openDatabase(dbPath)
  const other = new TaskRepository(otherDb)
  other.createTask({ parentId: vision.id, title: 'Written by another process' })
  assert.equal(repo.listTasks({ parentId: vision.id }).length, 2)

  // Cascade delete
  repo.deleteTask(project.id)
  assert.equal(repo.getTask(m1.id), null)

  otherDb.close()
  db.close()
  console.log('db-smoke: all checks passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
