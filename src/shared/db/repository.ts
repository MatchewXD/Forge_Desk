import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import {
  ASSIGNEES,
  PRIORITIES,
  RECURRENCES,
  RECURRING_LEVELS,
  STATUSES,
  childLevel,
  parentLevel,
  type Assignee,
  type Completion,
  type CreateTaskInput,
  type ListTasksFilter,
  type Level,
  type Note,
  type Priority,
  type Recurrence,
  type Status,
  type Task,
  type TaskNode,
  type TaskWithPath,
  type TodayView,
  type TreeOptions,
  type UpdateTaskInput
} from './model.ts'
import { addDays, firstOccurrence, isValidDate, nextOccurrence, toLocalDateString } from './dates.ts'

interface TaskRow {
  id: number
  parent_id: number | null
  level: Level
  title: string
  description: string
  status: Status
  deadline: string | null
  priority: Priority
  recurrence: Recurrence | null
  assignee: Assignee
  sort_order: number
  created_at: string
  updated_at: string
  completed_at: string | null
}

interface NoteRow {
  id: number
  task_id: number
  created_at: string
  author: Assignee
  text: string
}

interface CompletionRow {
  id: number
  task_id: number
  occurrence_date: string | null
  completed_at: string
}

export class TaskError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskError'
  }
}

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    parentId: r.parent_id,
    level: r.level,
    title: r.title,
    description: r.description,
    status: r.status,
    deadline: r.deadline,
    priority: r.priority,
    recurrence: r.recurrence ?? null,
    assignee: r.assignee ?? 'me',
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at
  }
}

function toNote(r: NoteRow): Note {
  return { id: r.id, taskId: r.task_id, createdAt: r.created_at, author: r.author, text: r.text }
}

function toCompletion(r: CompletionRow): Completion {
  return { id: r.id, taskId: r.task_id, occurrenceDate: r.occurrence_date, completedAt: r.completed_at }
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

function byDeadlineThenPriority(a: Task, b: Task): number {
  const d = (a.deadline ?? '').localeCompare(b.deadline ?? '')
  if (d !== 0) return d
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  return p !== 0 ? p : a.id - b.id
}

/**
 * All task reads/writes and business rules. Used by the Electron main process and the
 * MCP server alike — keep every rule here so both clients behave identically.
 */
export class TaskRepository {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  // ---------- reads ----------

  getTask(id: number): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    return row ? toTask(row) : null
  }

  listTasks(filter: ListTasksFilter = {}): Task[] {
    const where: string[] = []
    const params: SQLInputValue[] = []
    if (filter.parentId !== undefined) {
      if (filter.parentId === null) where.push('parent_id IS NULL')
      else {
        where.push('parent_id = ?')
        params.push(filter.parentId)
      }
    }
    if (filter.level) {
      where.push('level = ?')
      params.push(filter.level)
    }
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
      where.push(`status IN (${statuses.map(() => '?').join(',')})`)
      params.push(...statuses)
    } else if (filter.includeDone === false) {
      where.push("status != 'done'")
    }
    if (filter.assignee) {
      where.push('assignee = ?')
      params.push(filter.assignee)
    }
    if (filter.dueOnOrBefore) {
      where.push('deadline IS NOT NULL AND deadline <= ?')
      params.push(filter.dueOnOrBefore)
    }
    const sql =
      'SELECT * FROM tasks' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY parent_id, sort_order, id'
    return (this.db.prepare(sql).all(...params) as unknown as TaskRow[]).map(toTask)
  }

  /** Logged occurrences of recurring tasks, newest first (optionally for one task). */
  listCompletions(taskId?: number): Completion[] {
    const rows =
      taskId === undefined
        ? this.db.prepare('SELECT * FROM task_completions ORDER BY completed_at DESC, id DESC').all()
        : this.db
            .prepare('SELECT * FROM task_completions WHERE task_id = ? ORDER BY completed_at DESC, id DESC')
            .all(taskId)
    return (rows as unknown as CompletionRow[]).map(toCompletion)
  }

  /**
   * The forest (or the subtree under rootId) with rolled-up progress.
   * `assignee` keeps only that person's items, with their ancestors as context.
   * View:
   * - 'all': everything.
   * - 'active': open items. A done item is kept only as greyed context (`isContext`) when it
   *   still has open descendants.
   * - 'completed': done items and recurring tasks with logged completions (`completions`),
   *   plus their open ancestors as context so the original hierarchy is visible.
   * Progress is always computed on the full tree, so bars don't change with the view.
   */
  getTree(opts: TreeOptions = {}): TaskNode[] {
    const { rootId, view = 'all', assignee } = opts
    const nodes = new Map<number, TaskNode>()
    for (const t of this.listTasks()) {
      nodes.set(t.id, { ...t, children: [], progress: 0, leafCount: 0, leafDone: 0 })
    }
    const roots: TaskNode[] = []
    for (const n of nodes.values()) {
      const parent = n.parentId != null ? nodes.get(n.parentId) : undefined
      if (parent) parent.children.push(n)
      else roots.push(n)
    }
    const sortRec = (list: TaskNode[]): void => {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      for (const n of list) sortRec(n.children)
    }
    sortRec(roots)
    for (const r of roots) computeProgress(r)

    let forest = roots
    if (rootId !== undefined) {
      const root = nodes.get(rootId)
      forest = root ? [root] : []
    }
    if (view === 'all' && !assignee) return forest
    if (view === 'completed') {
      for (const c of this.listCompletions()) {
        const n = nodes.get(c.taskId)
        if (n) (n.completions ??= []).push(c)
      }
    }
    const inView = (n: TaskNode): boolean =>
      view === 'active'
        ? n.status !== 'done'
        : view === 'completed'
          ? n.status === 'done' || (n.completions?.length ?? 0) > 0
          : true
    const matches = (n: TaskNode): boolean => inView(n) && (!assignee || n.assignee === assignee)
    // In the archive, an open recurring task is shown greyed even though it carries a log.
    return prune(forest, matches, view === 'completed' ? (n) => n.status !== 'done' : undefined)
  }

  /** Ancestors of a task, root first (excluding the task itself). */
  getAncestors(id: number): Task[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE anc(id, parent_id, depth) AS (
           SELECT id, parent_id, 0 FROM tasks WHERE id = ?
           UNION ALL
           SELECT t.id, t.parent_id, anc.depth + 1 FROM tasks t JOIN anc ON t.id = anc.parent_id
         )
         SELECT t.* FROM anc JOIN tasks t ON t.id = anc.id WHERE anc.depth > 0 ORDER BY anc.depth DESC`
      )
      .all(id) as unknown as TaskRow[]
    return rows.map(toTask)
  }

  /** One item with rolled-up progress, its ancestors (root first), subtree, notes and completion log. */
  getTaskDetail(id: number): { task: TaskNode; ancestors: Task[]; notes: Note[]; completions: Completion[] } {
    const [node] = this.getTree({ rootId: id })
    if (!node) throw new TaskError(`Task ${id} not found`)
    return {
      task: node,
      ancestors: this.getAncestors(id),
      notes: this.listNotes(id),
      completions: this.listCompletions(id)
    }
  }

  /** An item's notes, oldest first. */
  listNotes(taskId: number): Note[] {
    this.requireTask(taskId)
    const rows = this.db.prepare('SELECT * FROM task_notes WHERE task_id = ? ORDER BY id').all(taskId)
    return (rows as unknown as NoteRow[]).map(toNote)
  }

  /**
   * Overdue, due today, and due in the next `days` days. Done items are excluded; recurring
   * tasks appear by their current (next) deadline.
   */
  getToday(today: string = toLocalDateString(), days = 7): TodayView {
    const horizon = addDays(today, days)
    const all = this.listTasks()
    const byId = new Map(all.map((t) => [t.id, t]))
    const withPath = (t: Task): TaskWithPath => {
      const path: string[] = []
      let p = t.parentId != null ? byId.get(t.parentId) : undefined
      while (p) {
        path.unshift(p.title)
        p = p.parentId != null ? byId.get(p.parentId) : undefined
      }
      return { ...t, path }
    }
    const open = all
      .filter((t) => t.status !== 'done' && t.deadline && t.deadline <= horizon)
      .sort(byDeadlineThenPriority)
    return {
      today,
      overdue: open.filter((t) => t.deadline! < today).map(withPath),
      dueToday: open.filter((t) => t.deadline === today).map(withPath),
      upcoming: open.filter((t) => t.deadline! > today).map(withPath)
    }
  }

  // ---------- writes ----------

  createTask(input: CreateTaskInput): Task {
    const title = input.title?.trim()
    if (!title) throw new TaskError('Title is required')

    const parentId = input.parentId ?? null
    let level: Level
    if (parentId === null) {
      level = input.level ?? 'vision'
      if (level !== 'vision') throw new TaskError(`A ${level} must have a parent`)
    } else {
      const parent = this.requireTask(parentId)
      const expected = childLevel(parent.level)
      if (!expected) throw new TaskError(`A ${parent.level} cannot have children`)
      level = input.level ?? expected
      if (level !== expected) {
        throw new TaskError(`A child of a ${parent.level} must be a ${expected}, not a ${level}`)
      }
    }

    const status = input.status ?? 'todo'
    const priority = input.priority ?? 'medium'
    const recurrence = input.recurrence ?? null
    const assignee = input.assignee ?? 'me'
    validateFields({ status, priority, deadline: input.deadline, recurrence, assignee })
    validateRecurrence(level, recurrence)
    let deadline = input.deadline ?? null
    if (recurrence && !deadline) deadline = firstOccurrence(recurrence, toLocalDateString())

    const now = new Date().toISOString()
    return this.tx(() => {
      const next = this.db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tasks WHERE parent_id IS ?')
        .get(parentId) as { n: number }
      const result = this.db
        .prepare(
          `INSERT INTO tasks (parent_id, level, title, description, status, deadline, priority,
                              recurrence, assignee, sort_order, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          parentId,
          level,
          title,
          input.description ?? '',
          status,
          deadline,
          priority,
          recurrence,
          assignee,
          next.n,
          now,
          now,
          status === 'done' ? now : null
        )
      return this.requireTask(Number(result.lastInsertRowid))
    })
  }

  /**
   * Patch fields. Setting status to 'done' on a recurring task completes the current occurrence
   * (see completeTask). Reopening a done item also reopens its done ancestors, so it reappears
   * in the active tree under its original parents.
   */
  updateTask(id: number, patch: UpdateTaskInput): Task {
    const current = this.requireTask(id)
    validateFields(patch)

    const recurrence = patch.recurrence !== undefined ? patch.recurrence : current.recurrence
    if (patch.recurrence !== undefined) validateRecurrence(current.level, patch.recurrence)
    if (patch.status === 'done' && recurrence && current.status !== 'done') {
      const { status: _ignored, ...rest } = patch
      this.updateTask(id, rest)
      return this.completeTask(id)
    }

    const sets: string[] = []
    const params: SQLInputValue[] = []
    const now = new Date().toISOString()

    if (patch.title !== undefined) {
      const title = patch.title.trim()
      if (!title) throw new TaskError('Title is required')
      sets.push('title = ?')
      params.push(title)
    }
    if (patch.description !== undefined) {
      sets.push('description = ?')
      params.push(patch.description)
    }
    if (patch.priority !== undefined) {
      sets.push('priority = ?')
      params.push(patch.priority)
    }
    if (patch.assignee !== undefined) {
      sets.push('assignee = ?')
      params.push(patch.assignee)
    }
    let deadline = patch.deadline !== undefined ? patch.deadline || null : current.deadline
    if (patch.recurrence !== undefined) {
      sets.push('recurrence = ?')
      params.push(patch.recurrence)
      // A recurring item always has a next due date.
      if (patch.recurrence && !deadline) deadline = firstOccurrence(patch.recurrence, toLocalDateString())
    }
    if (deadline !== current.deadline) {
      sets.push('deadline = ?')
      params.push(deadline)
    }
    const reopening = patch.status !== undefined && patch.status !== 'done' && current.status === 'done'
    if (patch.status !== undefined && patch.status !== current.status) {
      sets.push('status = ?', 'completed_at = ?')
      params.push(patch.status, patch.status === 'done' ? now : null)
    }
    if (sets.length === 0) return current

    sets.push('updated_at = ?')
    params.push(now, id)
    return this.tx(() => {
      this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params)
      if (reopening) this.reopenDoneAncestors(id, now)
      return this.requireTask(id)
    })
  }

  /**
   * Mark done. With cascade, also marks every open descendant done.
   * Recurring task: logs the completion, resets it (and its descendants) to todo, and moves the
   * deadline to the next occurrence. It never stays 'done'.
   */
  completeTask(id: number, opts: { cascade?: boolean } = {}): Task {
    const task = this.requireTask(id)
    const now = new Date().toISOString()
    if (task.recurrence && task.status !== 'done') {
      const today = toLocalDateString()
      const next = nextOccurrence(task.recurrence, task.deadline ?? today, today)
      return this.tx(() => {
        this.db
          .prepare('INSERT INTO task_completions (task_id, occurrence_date, completed_at) VALUES (?, ?, ?)')
          .run(id, task.deadline, now)
        this.db
          .prepare(
            `UPDATE tasks SET status = 'todo', completed_at = NULL, deadline = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(next, now, id)
        // Sub-items of a recurring task are a checklist that repeats with it.
        this.db
          .prepare(
            `WITH RECURSIVE sub(id) AS (
               SELECT id FROM tasks WHERE parent_id = ?
               UNION ALL SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id
             )
             UPDATE tasks SET status = 'todo', completed_at = NULL, updated_at = ?
             WHERE id IN sub AND status = 'done'`
          )
          .run(id, now)
        return this.requireTask(id)
      })
    }
    this.tx(() => {
      if (opts.cascade) {
        this.db
          .prepare(
            `WITH RECURSIVE sub(id) AS (
               SELECT ? UNION ALL SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id
             )
             UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ?
             WHERE id IN sub AND status != 'done'`
          )
          .run(id, now, now)
      } else {
        this.db
          .prepare(
            `UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ?
             WHERE id = ? AND status != 'done'`
          )
          .run(now, now, id)
      }
    })
    return this.requireTask(id)
  }

  /** Append a note to an item's log. Notes can't be edited or deleted. */
  addNote(taskId: number, text: string, author: Assignee = 'me'): Note {
    this.requireTask(taskId)
    const body = text?.trim()
    if (!body) throw new TaskError('Note text is required')
    validateFields({ assignee: author })
    const now = new Date().toISOString()
    return this.tx(() => {
      const r = this.db
        .prepare('INSERT INTO task_notes (task_id, created_at, author, text) VALUES (?, ?, ?, ?)')
        .run(taskId, now, author, body)
      this.db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, taskId)
      return toNote(
        this.db.prepare('SELECT * FROM task_notes WHERE id = ?').get(Number(r.lastInsertRowid)) as unknown as NoteRow
      )
    })
  }

  /** Back to todo (and its done ancestors with it). No-op for an item that isn't done. */
  reopenTask(id: number): Task {
    const task = this.requireTask(id)
    return task.status === 'done' ? this.updateTask(id, { status: 'todo' }) : task
  }

  /**
   * Move under a new parent (must be exactly one level up) and/or to a new position among
   * its siblings. `index` defaults to the end.
   */
  moveTask(id: number, newParentId: number | null, index?: number): Task {
    const task = this.requireTask(id)
    const expectedParent = parentLevel(task.level)
    if (newParentId === null) {
      if (expectedParent) throw new TaskError(`A ${task.level} must have a parent ${expectedParent}`)
    } else {
      const parent = this.requireTask(newParentId)
      if (parent.level !== expectedParent) {
        throw new TaskError(
          expectedParent
            ? `A ${task.level} can only be moved under a ${expectedParent}`
            : `A ${task.level} must stay at the top level`
        )
      }
    }

    return this.tx(() => {
      const siblings = (
        this.db
          .prepare('SELECT id FROM tasks WHERE parent_id IS ? AND id != ? ORDER BY sort_order, id')
          .all(newParentId, id) as { id: number }[]
      ).map((r) => r.id)
      const at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length))
      siblings.splice(at, 0, id)

      const setOrder = this.db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?')
      siblings.forEach((sid, i) => setOrder.run(i, sid))
      this.db
        .prepare('UPDATE tasks SET parent_id = ?, updated_at = ? WHERE id = ?')
        .run(newParentId, new Date().toISOString(), id)
      return this.requireTask(id)
    })
  }

  /** Deletes the task and (via ON DELETE CASCADE) all of its descendants and completion logs. */
  deleteTask(id: number): void {
    this.requireTask(id)
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  // ---------- helpers ----------

  private reopenDoneAncestors(id: number, now: string): void {
    this.db
      .prepare(
        `WITH RECURSIVE anc(id, parent_id) AS (
           SELECT id, parent_id FROM tasks WHERE id = ?
           UNION ALL SELECT t.id, t.parent_id FROM tasks t JOIN anc ON t.id = anc.parent_id
         )
         UPDATE tasks SET status = 'todo', completed_at = NULL, updated_at = ?
         WHERE id IN (SELECT id FROM anc WHERE id != ?) AND status = 'done'`
      )
      .run(id, now, id)
  }

  private requireTask(id: number): Task {
    const t = this.getTask(id)
    if (!t) throw new TaskError(`Task ${id} not found`)
    return t
  }

  private tx<T>(fn: () => T): T {
    if (this.db.isTransaction) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      this.db.exec('COMMIT')
      return out
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }
}

/**
 * Keep nodes matching `keep`, plus any ancestor of a kept node (marked isContext unless it
 * matches). `context` overrides which kept nodes are shown as greyed context.
 */
function prune(
  nodes: TaskNode[],
  keep: (n: TaskNode) => boolean,
  context: (n: TaskNode) => boolean = (n) => !keep(n)
): TaskNode[] {
  const out: TaskNode[] = []
  for (const n of nodes) {
    const children = prune(n.children, keep, context)
    const kept = keep(n)
    if (kept || children.length > 0) out.push({ ...n, children, isContext: !kept || context(n) })
  }
  return out
}

function computeProgress(n: TaskNode): void {
  if (n.children.length === 0) {
    n.leafCount = 1
    n.leafDone = n.status === 'done' ? 1 : 0
    n.progress = n.leafDone
    return
  }
  let sum = 0
  n.leafCount = 0
  n.leafDone = 0
  for (const c of n.children) {
    computeProgress(c)
    sum += c.progress
    n.leafCount += c.leafCount
    n.leafDone += c.leafDone
  }
  n.progress = sum / n.children.length
}

function validateRecurrence(level: Level, recurrence: Recurrence | null | undefined): void {
  if (recurrence && !RECURRING_LEVELS.includes(level)) {
    throw new TaskError(`Only tasks and micro-tasks can repeat, not a ${level}`)
  }
}

function validateFields(f: {
  status?: string
  priority?: string
  deadline?: string | null
  recurrence?: string | null
  assignee?: string
}): void {
  if (f.status !== undefined && !(STATUSES as readonly string[]).includes(f.status)) {
    throw new TaskError(`Invalid status "${f.status}" (expected ${STATUSES.join(', ')})`)
  }
  if (f.priority !== undefined && !(PRIORITIES as readonly string[]).includes(f.priority)) {
    throw new TaskError(`Invalid priority "${f.priority}" (expected ${PRIORITIES.join(', ')})`)
  }
  if (f.deadline && !isValidDate(f.deadline)) {
    throw new TaskError(`Invalid deadline "${f.deadline}" (expected YYYY-MM-DD)`)
  }
  if (f.assignee !== undefined && !(ASSIGNEES as readonly string[]).includes(f.assignee)) {
    throw new TaskError(`Invalid assignee "${f.assignee}" (expected ${ASSIGNEES.join(', ')})`)
  }
  if (f.recurrence && !(RECURRENCES as readonly string[]).includes(f.recurrence)) {
    throw new TaskError(`Invalid recurrence "${f.recurrence}" (expected ${RECURRENCES.join(', ')} or null)`)
  }
}
