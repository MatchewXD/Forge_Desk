import { useEffect, useMemo, useRef, useState } from 'react'
import { toLocalDateString } from '@shared/db/dates.ts'
import { ForgeContext, useForgeData } from './store'
import { Sidebar, type View } from './components/Sidebar'
import { TasksView } from './views/TasksView'
import { TodayView } from './views/TodayView'
import { CompletedView } from './views/CompletedView'
import { ancestorIds, countCompleted, indexTree } from './lib'
import type { AddTarget } from './components/TaskTree'

export type ExpandedUpdate = Set<number> | ((prev: Set<number>) => Set<number>)

// Per-machine UI conveniences only; all real data lives in SQLite.
function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`forge:${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`forge:${key}`, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export default function App(): React.JSX.Element {
  const forge = useForgeData()
  const [view, setView] = useState<View>(() => loadPref<View>('view', 'today'))
  const [expanded, setExpandedState] = useState<Set<number>>(() => new Set(loadPref<number[]>('expanded', [])))
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [addTarget, setAddTarget] = useState<AddTarget>(null)
  const firstLoad = useRef(true)

  const setExpanded = (update: ExpandedUpdate): void => setExpandedState(update)
  useEffect(() => savePref('expanded', [...expanded]), [expanded])
  const navigate = (v: View): void => {
    setView(v)
    savePref('view', v)
  }

  const index = useMemo(() => indexTree(forge.tree), [forge.tree])

  // First run with no saved expansion: open visions and projects.
  useEffect(() => {
    if (!forge.loaded || !firstLoad.current) return
    firstLoad.current = false
    if (expanded.size === 0 && forge.tree.length > 0) {
      const s = new Set<number>()
      for (const e of index.values()) if (e.depth <= 1 && e.node.children.length) s.add(e.node.id)
      setExpanded(s)
    }
  }, [forge.loaded])

  // Drop selection if the item disappears (deleted here or by another process).
  useEffect(() => {
    if (selectedId != null && forge.loaded && !index.has(selectedId)) setSelectedId(null)
  }, [index, selectedId, forge.loaded])

  const openTask = (id: number): void => {
    setExpanded((prev) => {
      const s = new Set(prev)
      for (const a of ancestorIds(index, id)) s.add(a)
      return s
    })
    setSelectedId(id)
    navigate('tasks')
  }

  const today = forge.today?.today ?? toLocalDateString()
  const completedCount = useMemo(() => countCompleted(forge.completed), [forge.completed])

  return (
    <ForgeContext.Provider value={forge}>
      <div className="app">
        <Sidebar
          view={view}
          onNavigate={navigate}
          counts={{
            overdue: forge.today?.overdue.length ?? 0,
            today: forge.today?.dueToday.length ?? 0,
            completed: completedCount
          }}
        />
        <main className="content">
          {!forge.loaded ? null : view === 'today' ? (
            <TodayView onOpenTask={openTask} />
          ) : view === 'completed' ? (
            <CompletedView />
          ) : (
            <TasksView
              today={today}
              expanded={expanded}
              setExpanded={setExpanded}
              selectedId={selectedId}
              onSelect={setSelectedId}
              addTarget={addTarget}
              setAddTarget={setAddTarget}
            />
          )}
        </main>
        {forge.notice && (
          <div
            key={forge.notice.id}
            className={`toast ${forge.notice.kind}`}
            role={forge.notice.kind === 'error' ? 'alert' : 'status'}
          >
            <span>{forge.notice.text}</span>
            {forge.notice.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  forge.notice?.action?.run()
                  forge.dismissNotice()
                }}
              >
                {forge.notice.action.label}
              </button>
            )}
            <button type="button" className="icon-btn" onClick={forge.dismissNotice} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
      </div>
    </ForgeContext.Provider>
  )
}
