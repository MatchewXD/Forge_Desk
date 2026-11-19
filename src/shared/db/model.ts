// Types and constants for the task hierarchy.
// Pure module: safe to import from the renderer, main process, and MCP server.

export const LEVELS = ['vision', 'project', 'milestone', 'task', 'microtask'] as const
export type Level = (typeof LEVELS)[number]

export const LEVEL_LABELS: Record<Level, string> = {
  vision: 'Vision',
  project: 'Project',
  milestone: 'Milestone',
  task: 'Task',
  microtask: 'Micro-task'
}

export const STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_LABELS: Record<Status, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done'
}

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent'
}

export interface Task {
  id: number
  parentId: number | null
  level: Level
  title: string
  description: string
  status: Status
  /** Local calendar date, YYYY-MM-DD */
  deadline: string | null
  priority: Priority
  sortOrder: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface TaskNode extends Task {
  children: TaskNode[]
  /** 0..1, rolled up from children (leaf: 1 if done else 0) */
  progress: number
  /** Count of leaf descendants (or 1 for a leaf) and how many are done */
  leafCount: number
  leafDone: number
}

/** A task with its ancestor titles, root first — used for breadcrumbs in flat lists. */
export interface TaskWithPath extends Task {
  path: string[]
}

export interface TodayView {
  today: string
  overdue: TaskWithPath[]
  dueToday: TaskWithPath[]
  upcoming: TaskWithPath[]
}

export interface CreateTaskInput {
  parentId?: number | null
  /** Optional; inferred from the parent when omitted (root => vision). */
  level?: Level
  title: string
  description?: string
  status?: Status
  deadline?: string | null
  priority?: Priority
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  status?: Status
  deadline?: string | null
  priority?: Priority
}

export interface ListTasksFilter {
  parentId?: number | null
  level?: Level
  status?: Status | Status[]
  dueOnOrBefore?: string
  includeDone?: boolean
}

export function levelIndex(level: Level): number {
  return LEVELS.indexOf(level)
}

/** The level a child of `level` must have, or null if `level` is a leaf level. */
export function childLevel(level: Level): Level | null {
  const i = levelIndex(level)
  return i < LEVELS.length - 1 ? LEVELS[i + 1] : null
}

/** The level a parent of `level` must have, or null for root-level items. */
export function parentLevel(level: Level): Level | null {
  const i = levelIndex(level)
  return i > 0 ? LEVELS[i - 1] : null
}
