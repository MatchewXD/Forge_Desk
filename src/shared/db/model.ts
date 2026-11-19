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

export const RECURRENCES = ['daily', 'weekdays', 'weekly'] as const
export type Recurrence = (typeof RECURRENCES)[number]

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly'
}

/** Only these levels may repeat. */
export const RECURRING_LEVELS: readonly Level[] = ['task', 'microtask']

/** Which items a tree contains. Pruned-away ancestors are kept as `isContext` nodes. */
export type TreeView = 'all' | 'active' | 'completed'

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
  /** Set on recurring tasks: completing one logs a Completion and rolls the deadline forward. */
  recurrence: Recurrence | null
  sortOrder: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

/** One logged occurrence of a recurring task. */
export interface Completion {
  id: number
  taskId: number
  /** The deadline of the occurrence that was completed (YYYY-MM-DD), if it had one */
  occurrenceDate: string | null
  completedAt: string
}

export interface TaskNode extends Task {
  children: TaskNode[]
  /** 0..1, rolled up from children (leaf: 1 if done else 0). Always computed on the full tree. */
  progress: number
  /** Count of leaf descendants (or 1 for a leaf) and how many are done */
  leafCount: number
  leafDone: number
  /**
   * In a filtered view: true when this node doesn't itself belong to the view and is only
   * shown so its descendants keep their place in the hierarchy (render greyed out).
   */
  isContext?: boolean
  /** Completed view only: logged occurrences of a recurring task, newest first. */
  completions?: Completion[]
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
  /** task/microtask only. Without a deadline, the first occurrence is due today. */
  recurrence?: Recurrence | null
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  status?: Status
  deadline?: string | null
  priority?: Priority
  recurrence?: Recurrence | null
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
