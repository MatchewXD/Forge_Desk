import { useEffect, useMemo, useRef } from 'react'
import { ASSIGNEES, ASSIGNEE_LABELS } from '@shared/db/model.ts'
import { useForge } from '../store'
import { indexTree } from '../lib'
import { TaskTree, type AddTarget } from '../components/TaskTree'
import { DetailPanel } from '../components/DetailPanel'
import { ProgressBar } from '../components/Badges'
import type { ExpandedUpdate } from '../App'

interface Props {
  today: string
  expanded: Set<number>
  setExpanded: (update: ExpandedUpdate) => void
  selectedId: number | null
  onSelect: (id: number | null) => void
  addTarget: AddTarget
  setAddTarget: (t: AddTarget) => void
}

export function TasksView(p: Props): React.JSX.Element {
  const { tree, completed, assigneeFilter, setAssigneeFilter } = useForge()
  const index = useMemo(() => indexTree(tree), [tree])
  const selected = p.selectedId != null ? (index.get(p.selectedId)?.node ?? null) : null

  // When an assignee filter is chosen, open the filtered paths once so the matches are visible
  // (the user can still collapse afterwards; later refreshes don't re-expand).
  const expandOnNextTree = useRef(false)
  useEffect(() => {
    expandOnNextTree.current = assigneeFilter !== 'all'
  }, [assigneeFilter])
  useEffect(() => {
    if (!expandOnNextTree.current) return
    expandOnNextTree.current = false
    p.setExpanded((prev) => {
      const next = new Set(prev)
      for (const e of index.values()) if (e.node.children.length) next.add(e.node.id)
      return next
    })
  }, [index])

  const toggleExpand = (id: number): void =>
    p.setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const expandAll = (): void => {
    const all = new Set<number>()
    for (const e of index.values()) if (e.node.children.length) all.add(e.node.id)
    p.setExpanded(all)
  }

  const addChild = (id: number): void => {
    p.setExpanded((prev) => new Set(prev).add(id))
    p.setAddTarget(id)
  }

  const overall = tree.length ? tree.reduce((s, n) => s + n.progress, 0) / tree.length : 0

  return (
    <div className="view tasks-view">
      <div className="view-main">
        <header className="view-header">
          <div>
            <h1>Tasks</h1>
            <p className="muted">
              {tree.length} vision{tree.length === 1 ? '' : 's'}
              {tree.length > 0 && (
                <>
                  {' · '}
                  <span className="inline-progress">
                    <ProgressBar progress={overall} /> overall
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="toolbar">
            <div className="segmented" role="radiogroup" aria-label="Filter by assignee">
              {(['all', ...ASSIGNEES] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={assigneeFilter === a}
                  className={assigneeFilter === a ? 'active' : ''}
                  onClick={() => setAssigneeFilter(a)}
                >
                  {a === 'all' ? 'Everyone' : ASSIGNEE_LABELS[a]}
                </button>
              ))}
            </div>
            <button type="button" className="btn ghost" onClick={expandAll}>
              Expand all
            </button>
            <button type="button" className="btn ghost" onClick={() => p.setExpanded(new Set())}>
              Collapse all
            </button>
            <button type="button" className="btn primary" onClick={() => p.setAddTarget('root')}>
              + New vision
            </button>
          </div>
        </header>

        {tree.length === 0 && assigneeFilter !== 'all' ? (
          <div className="empty">
            <h2>Nothing assigned to {ASSIGNEE_LABELS[assigneeFilter]}</h2>
            <p className="muted">No open items have this assignee.</p>
            <button type="button" className="btn" onClick={() => setAssigneeFilter('all')}>
              Show everyone
            </button>
          </div>
        ) : tree.length === 0 && p.addTarget !== 'root' ? (
          <div className="empty">
            {completed.length > 0 ? (
              <>
                <h2>Everything is done</h2>
                <p className="muted">Finished items live on the Completed page. Start a new vision?</p>
              </>
            ) : (
              <>
                <h2>Start with a vision</h2>
                <p className="muted">
                  A vision is the big-picture goal. Break it into projects, milestones, tasks and micro-tasks —
                  progress rolls up automatically.
                </p>
              </>
            )}
            <button type="button" className="btn primary" onClick={() => p.setAddTarget('root')}>
              + Create your first vision
            </button>
          </div>
        ) : (
          <div className="tree-scroll">
            <TaskTree
              roots={tree}
              today={p.today}
              expanded={p.expanded}
              onToggleExpand={toggleExpand}
              selectedId={p.selectedId}
              onSelect={p.onSelect}
              addTarget={p.addTarget}
              onAddTarget={(t) => (typeof t === 'number' ? addChild(t) : p.setAddTarget(t))}
            />
          </div>
        )}
      </div>

      {selected && (
        <DetailPanel
          node={selected}
          index={index}
          onClose={() => p.onSelect(null)}
          onSelect={p.onSelect}
          onAddChild={addChild}
        />
      )}
    </div>
  )
}
