import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import {
  PRIORITIES,
  STATUSES,
  childLevel,
  parentLevel,
  type CreateTaskInput,
  type ListTasksFilter,
  type Level,
  type Priority,
  type Status,
  type Task,
  type TaskNode,
  type TaskWithPath,
  type TodayView,
  type UpdateTaskInput
} from './model.ts'
import { addDays, isValidDate, toLocalDateString } from './dates.ts'

interface TaskRow {
  id: number
  parent_id: number | null
  level: Level
  title: string
  description: string
  status: Status
  deadline: string | null
  priority: Priority
  sort_order: number
  created_at: string
  updated_at: string
  completed_at: string | null
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
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at
  }
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

  /** The full forest (or the subtree under rootId) with rolled-up progress. */
  getTree(rootId?: number): TaskNode[] {
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

    if (rootId !== undefined) {
      const root = nodes.get(rootId)
      return root ? [root] : []
    }
    return roots
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

  /** One item with rolled-up progress, its ancestors (root first) and its full subtree. */
  getTaskDetail(id: number): { task: TaskNode; ancestors: Task[] } {
    const [node] = this.getTree(id)
    if (!node) throw new TaskError(`Task ${id} not found`)
    return { task: node, ancestors: this.getAncestors(id) }
  }

  /** Overdue, due today, and due in the next `days` days. Done items are excluded. */
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
    const deadline = input.deadline ?? null
    validateFields({ status, priority, deadline })

    const now = new Date().toISOString()
    return this.tx(() => {
      const next = this.db
        .prepare(
          'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tasks WHERE parent_id IS ?'
        )
        .get(parentId) as { n: number }
      const result = this.db
        .prepare(
          `INSERT INTO tasks (parent_id, level, title, description, status, deadline, priority,
                              sort_order, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          parentId,
          level,
          title,
          input.description ?? '',
          status,
          deadline,
          priority,
          next.n,
          now,
          now,
          status === 'done' ? now : null
        )
      return this.requireTask(Number(result.lastInsertRowid))
    })
  }

  updateTask(id: number, patch: UpdateTaskInput): Task {
    const current = this.requireTask(id)
    validateFields(patch)
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
    if (patch.deadline !== undefined) {
      sets.push('deadline = ?')
      params.push(patch.deadline || null)
    }
    if (patch.status !== undefined && patch.status !== current.status) {
      sets.push('status = ?', 'completed_at = ?')
      params.push(patch.status, patch.status === 'done' ? now : null)
    }
    if (sets.length === 0) return current

    sets.push('updated_at = ?')
    params.push(now, id)
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return this.requireTask(id)
  }

  /** Mark done. With cascade, also marks every open descendant done. */
  completeTask(id: number, opts: { cascade?: boolean } = {}): Task {
    this.requireTask(id)
    const now = new Date().toISOString()
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

  /** Deletes the task and (via ON DELETE CASCADE) all of its descendants. */
  deleteTask(id: number): void {
    this.requireTask(id)
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  // ---------- helpers ----------

  private requireTask(id: number): Task {
    const t = this.getTask(id)
    if (!t) throw new TaskError(`Task ${id} not found`)
    return t
  }

  private tx<T>(fn: () => T): T {
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

function validateFields(f: { status?: string; priority?: string; deadline?: string | null }): void {
  if (f.status !== undefined && !(STATUSES as readonly string[]).includes(f.status)) {
    throw new TaskError(`Invalid status "${f.status}" (expected ${STATUSES.join(', ')})`)
  }
  if (f.priority !== undefined && !(PRIORITIES as readonly string[]).includes(f.priority)) {
    throw new TaskError(`Invalid priority "${f.priority}" (expected ${PRIORITIES.join(', ')})`)
  }
  if (f.deadline && !isValidDate(f.deadline)) {
    throw new TaskError(`Invalid deadline "${f.deadline}" (expected YYYY-MM-DD)`)
  }
}
