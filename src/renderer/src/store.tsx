import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type {
  Assignee,
  CreateTaskInput,
  Note,
  Task,
  TaskNode,
  TodayView,
  UpdateTaskInput
} from '@shared/db/model.ts'
import { toLocalDateString } from '@shared/db/dates.ts'
import { longDate } from './lib'

const api = window.forge

export interface Notice {
  id: number
  kind: 'info' | 'error'
  text: string
  action?: { label: string; run: () => void }
}

export type AssigneeFilter = Assignee | 'all'

export interface ForgeData {
  /** Active tree: open items (done ancestors only as context), filtered by assignee. */
  tree: TaskNode[]
  assigneeFilter: AssigneeFilter
  setAssigneeFilter: (f: AssigneeFilter) => void
  /** Bumps on every data refresh (incl. external changes) so per-item fetches can follow. */
  version: number
  listNotes: (taskId: number) => Promise<Note[]>
  addNote: (taskId: number, text: string) => Promise<boolean>
  /** Completed archive tree: done items + recurring completion logs, open ancestors as context. */
  completed: TaskNode[]
  today: TodayView | null
  loaded: boolean
  notice: Notice | null
  dismissNotice: () => void
  refresh: () => Promise<void>
  createTask: (input: CreateTaskInput) => Promise<Task | null>
  /** Resolves false if the update was rejected (the error is shown as a notice). */
  updateTask: (id: number, patch: UpdateTaskInput) => Promise<boolean>
  moveTask: (id: number, parentId: number | null, index?: number) => Promise<void>
  /** Complete an item (recurring: log the occurrence and roll forward). Shows a notice with Undo. */
  complete: (task: Task, cascade?: boolean) => Promise<void>
  /** Reopen a done item (and its done ancestors) back into the active tree. */
  reopen: (task: Task) => Promise<void>
  deleteTask: (id: number) => Promise<void>
}

let noticeSeq = 0

export function useForgeData(): ForgeData {
  const [tree, setTree] = useState<TaskNode[]>([])
  const [completed, setCompleted] = useState<TaskNode[]>([])
  const [today, setToday] = useState<TodayView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [version, setVersion] = useState(0)
  const [assigneeFilter, setAssigneeFilterState] = useState<AssigneeFilter>(() => {
    try {
      return (localStorage.getItem('forge:assigneeFilter') as AssigneeFilter | null) ?? 'all'
    } catch {
      return 'all'
    }
  })
  const setAssigneeFilter = (f: AssigneeFilter): void => {
    setAssigneeFilterState(f)
    try {
      localStorage.setItem('forge:assigneeFilter', f)
    } catch {
      /* ignore */
    }
  }
  const [notice, setNotice] = useState<Notice | null>(null)
  const seq = useRef(0)

  const notify = useCallback((n: Omit<Notice, 'id'>) => setNotice({ ...n, id: ++noticeSeq }), [])

  // Info notices fade on their own; errors stay until dismissed.
  useEffect(() => {
    if (!notice || notice.kind === 'error') return
    const t = setTimeout(() => setNotice((cur) => (cur?.id === notice.id ? null : cur)), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    try {
      const [t, c, d] = await Promise.all([
        api.getTree({ view: 'active', assignee: assigneeFilter === 'all' ? undefined : assigneeFilter }),
        api.getTree({ view: 'completed' }),
        api.getToday(toLocalDateString())
      ])
      if (mine !== seq.current) return // a newer refresh superseded this one
      setTree(t)
      setCompleted(c)
      setToday(d)
      setLoaded(true)
      setVersion((v) => v + 1)
    } catch (e) {
      notify({ kind: 'error', text: (e as Error).message })
    }
  }, [notify, assigneeFilter])

  useEffect(() => {
    void refresh()
    const off = api.onExternalChange(() => void refresh())
    // Re-read on focus so "today" rolls over and stays fresh.
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        const out = await fn()
        await refresh()
        return out
      } catch (e) {
        notify({ kind: 'error', text: (e as Error).message })
        return null
      }
    },
    [refresh, notify]
  )

  const reopen = async (task: Task): Promise<void> => {
    const out = await run(() => api.reopenTask(task.id))
    if (out) notify({ kind: 'info', text: `Reopened “${task.title}”` })
  }

  const complete = async (task: Task, cascade?: boolean): Promise<void> => {
    const out = await run(() => api.completeTask(task.id, cascade))
    if (!out) return
    if (task.recurrence && out.status !== 'done') {
      notify({
        kind: 'info',
        text: `Logged “${task.title}”${out.deadline ? ` — next due ${longDate(out.deadline)}` : ''}`
      })
    } else {
      notify({
        kind: 'info',
        text: `Completed “${task.title}”`,
        action: cascade ? undefined : { label: 'Undo', run: () => void reopen(out) }
      })
    }
  }

  return {
    tree,
    assigneeFilter,
    setAssigneeFilter,
    version,
    listNotes: (taskId) => api.listNotes(taskId),
    addNote: async (taskId, text) => (await run(() => api.addNote(taskId, text, 'me'))) !== null,
    completed,
    today,
    loaded,
    notice,
    dismissNotice: () => setNotice(null),
    refresh,
    createTask: (input) => run(() => api.createTask(input)),
    updateTask: async (id, patch) => (await run(() => api.updateTask(id, patch))) !== null,
    moveTask: async (id, parentId, index) => void (await run(() => api.moveTask(id, parentId, index))),
    complete,
    reopen,
    deleteTask: async (id) => void (await run(() => api.deleteTask(id)))
  }
}

export const ForgeContext = createContext<ForgeData | null>(null)

export function useForge(): ForgeData {
  const ctx = useContext(ForgeContext)
  if (!ctx) throw new Error('useForge must be used inside ForgeContext')
  return ctx
}
