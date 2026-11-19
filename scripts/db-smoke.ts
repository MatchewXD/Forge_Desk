// Smoke test for the shared DB layer, run in plain Node (no Electron):
//   npm run test:db
// Exercises the same code path the Phase 1.5 MCP server will use.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TaskRepository,
  openDatabase,
  addDays,
  firstOccurrence,
  nextOccurrence,
  toLocalDateString,
  type TaskNode
} from '../src/shared/db/index.ts'

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

  // ---------- active / completed views ----------
  const v2 = repo.createTask({ title: 'V2' })
  const p2 = repo.createTask({ parentId: v2.id, title: 'P2' })
  const msA = repo.createTask({ parentId: p2.id, title: 'MsA' })
  const doneTask = repo.createTask({ parentId: msA.id, title: 'Done task' })
  const openTask = repo.createTask({ parentId: msA.id, title: 'Open task' })
  repo.completeTask(doneTask.id)
  const titles = (nodes: TaskNode[]): string[] =>
    nodes.flatMap((n) => [`${n.title}${n.isContext ? '*' : ''}`, ...titles(n.children)])
  assert.deepEqual(titles(repo.getTree(v2.id, 'active')), ['V2', 'P2', 'MsA', 'Open task'])
  assert.deepEqual(titles(repo.getTree(v2.id, 'completed')), ['V2*', 'P2*', 'MsA*', 'Done task'])
  assert.equal(repo.getTree(v2.id, 'active')[0].progress, 0.5) // progress uses the full tree

  // Done parent with an open child: parent stays in the active tree as context
  repo.completeTask(msA.id)
  assert.deepEqual(titles(repo.getTree(v2.id, 'active')), ['V2', 'P2', 'MsA*', 'Open task'])
  assert.deepEqual(titles(repo.getTree(v2.id, 'completed')), ['V2*', 'P2*', 'MsA', 'Done task'])

  // Reopening a child also reopens its done ancestors
  repo.reopenTask(doneTask.id)
  assert.equal(repo.getTask(msA.id)!.status, 'todo')
  assert.equal(repo.getTask(doneTask.id)!.completedAt, null)
  assert.deepEqual(titles(repo.getTree(v2.id, 'completed')), [])

  // ---------- recurrence ----------
  assert.equal(nextOccurrence('weekdays', '2026-11-20', '2026-11-19'), '2026-11-23') // Fri -> Mon
  assert.equal(nextOccurrence('weekly', '2026-11-20', '2026-11-19'), '2026-11-27')
  assert.equal(nextOccurrence('daily', '2026-11-10', '2026-11-19'), '2026-11-20') // missed days skip ahead
  assert.equal(nextOccurrence('weekly', '2026-11-02', '2026-11-19'), '2026-11-23') // keeps weekday (Mon)
  assert.equal(firstOccurrence('weekdays', '2026-11-21'), '2026-11-23') // Sat -> Mon

  assert.throws(() => repo.updateTask(msA.id, { recurrence: 'daily' }), /Only tasks and micro-tasks/)
  assert.throws(() => repo.updateTask(openTask.id, { recurrence: 'hourly' as never }), /Invalid recurrence/)

  const daily = repo.createTask({ parentId: msA.id, title: 'Standup', recurrence: 'daily' })
  assert.equal(daily.deadline, today) // no deadline given -> first occurrence today
  const step1 = repo.createTask({ parentId: daily.id, title: 'Check board' })
  repo.completeTask(step1.id)

  const afterDaily = repo.completeTask(daily.id)
  assert.equal(afterDaily.status, 'todo')
  assert.equal(afterDaily.deadline, addDays(today, 1))
  assert.equal(repo.getTask(step1.id)!.status, 'todo') // checklist resets with it
  let log = repo.listCompletions(daily.id)
  assert.equal(log.length, 1)
  assert.equal(log[0].occurrenceDate, today)

  // status=done through updateTask also logs an occurrence
  repo.updateTask(daily.id, { status: 'done' })
  assert.equal(repo.getTask(daily.id)!.deadline, addDays(today, 2))
  log = repo.listCompletions(daily.id)
  assert.equal(log.length, 2)

  // Completed view: recurring task as context, carrying its log
  const done = repo.getTree(v2.id, 'completed')
  const standup = done[0].children[0].children[0].children.find((n) => n.title === 'Standup')!
  assert.equal(standup.isContext, true)
  assert.equal(standup.completions!.length, 2)
  // Still in the active tree and on Today when due
  assert.ok(titles(repo.getTree(v2.id, 'active')).includes('Standup'))

  const weekly = repo.createTask({ parentId: msA.id, title: 'Review', recurrence: 'weekly', deadline: addDays(today, -3) })
  assert.deepEqual(repo.getToday(today).overdue.map((t) => t.title), ['Review'])
  assert.equal(repo.completeTask(weekly.id).deadline, addDays(today, 4))

  // Turning recurrence off makes it a normal task again
  repo.updateTask(weekly.id, { recurrence: null })
  assert.equal(repo.completeTask(weekly.id).status, 'done')

  otherDb.close()
  db.close()
  console.log('db-smoke: all checks passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
