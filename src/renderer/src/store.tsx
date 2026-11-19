import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type {
  CreateTaskInput,
  Task,
  TaskNode,
  TodayView,
  UpdateTaskInput
} from '@shared/db/model.ts'
import { toLocalDateString } from '@shared/db/dates.ts'

const api = window.forge

export interface ForgeData {
  tree: TaskNode[]
  today: TodayView | null
  loaded: boolean
  error: string | null
  clearError: () => void
  refresh: () => Promise<void>
  createTask: (input: CreateTaskInput) => Promise<Task | null>
  updateTask: (id: number, patch: UpdateTaskInput) => Promise<void>
  moveTask: (id: number, parentId: number | null, index?: number) => Promise<void>
  /** Toggle done. Completing an item with open descendants cascades to them. */
  setDone: (id: number, done: boolean, cascade?: boolean) => Promise<void>
  deleteTask: (id: number) => Promise<void>
}

export function useForgeData(): ForgeData {
  const [tree, setTree] = useState<TaskNode[]>([])
  const [today, setToday] = useState<TodayView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    try {
      const [t, d] = await Promise.all([api.getTree(), api.getToday(toLocalDateString())])
      if (mine !== seq.current) return // a newer refresh superseded this one
      setTree(t)
      setToday(d)
      setLoaded(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

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
        setError((e as Error).message)
        return null
      }
    },
    [refresh]
  )

  return {
    tree,
    today,
    loaded,
    error,
    clearError: () => setError(null),
    refresh,
    createTask: (input) => run(() => api.createTask(input)),
    updateTask: async (id, patch) => void (await run(() => api.updateTask(id, patch))),
    moveTask: async (id, parentId, index) => void (await run(() => api.moveTask(id, parentId, index))),
    setDone: async (id, done, cascade) =>
      void (await run(() =>
        done ? api.completeTask(id, cascade) : api.updateTask(id, { status: 'todo' })
      )),
    deleteTask: async (id) => void (await run(() => api.deleteTask(id)))
  }
}

export const ForgeContext = createContext<ForgeData | null>(null)

export function useForge(): ForgeData {
  const ctx = useContext(ForgeContext)
  if (!ctx) throw new Error('useForge must be used inside ForgeContext')
  return ctx
}
