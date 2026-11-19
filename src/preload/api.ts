// The typed API the preload script exposes to the renderer as `window.forge`.
// Type-only module: shared by preload (implementation) and renderer (consumer).
import type {
  Assignee,
  Note,
  CreateTaskInput,
  Task,
  TaskNode,
  TodayView,
  TreeOptions,
  UpdateTaskInput
} from '../shared/db/model.ts'

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface ForgeApi {
  getTree(opts?: TreeOptions): Promise<TaskNode[]>
  getToday(today?: string): Promise<TodayView>
  getAncestors(id: number): Promise<Task[]>
  createTask(input: CreateTaskInput): Promise<Task>
  updateTask(id: number, patch: UpdateTaskInput): Promise<Task>
  moveTask(id: number, newParentId: number | null, index?: number): Promise<Task>
  completeTask(id: number, cascade?: boolean): Promise<Task>
  reopenTask(id: number): Promise<Task>
  listNotes(taskId: number): Promise<Note[]>
  addNote(taskId: number, text: string, author?: Assignee): Promise<Note>
  deleteTask(id: number): Promise<void>
  dbPath(): Promise<string>
  /** Fires when the database is changed by another process (e.g. the MCP server). */
  onExternalChange(cb: () => void): () => void
}

export const CHANNELS = {
  getTree: 'tasks:getTree',
  getToday: 'tasks:getToday',
  getAncestors: 'tasks:getAncestors',
  createTask: 'tasks:create',
  updateTask: 'tasks:update',
  moveTask: 'tasks:move',
  completeTask: 'tasks:complete',
  reopenTask: 'tasks:reopen',
  listNotes: 'notes:list',
  addNote: 'notes:add',
  deleteTask: 'tasks:delete',
  dbPath: 'app:dbPath',
  dbChanged: 'db:changed'
} as const
