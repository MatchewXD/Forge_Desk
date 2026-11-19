import { useState } from 'react'
import type { Completion, TaskNode } from '@shared/db/model.ts'
import { parseLocalDate } from '@shared/db/dates.ts'
import { useForge } from '../store'
import { countCompleted, formatTimestamp } from '../lib'
import { LevelTag, RecurrenceTag } from '../components/Badges'

const LOG_PREVIEW = 5

/**
 * The archive: done items in their original hierarchy. Open ancestors appear greyed out as
 * context; recurring tasks list their logged occurrences beneath them.
 */
export function CompletedView(): React.JSX.Element {
  const { completed } = useForge()
  // Everything starts expanded; track what the user collapsed.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const toggle = (id: number): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const collapseAll = (): void => {
    const all = new Set<number>()
    const walk = (nodes: TaskNode[]): void => {
      for (const n of nodes) {
        if (n.children.length || n.completions?.length) all.add(n.id)
        walk(n.children)
      }
    }
    walk(completed)
    setCollapsed(all)
  }

  const total = countCompleted(completed)
  const rows: React.JSX.Element[] = []
  const walk = (nodes: TaskNode[], depth: number): void => {
    for (const n of nodes) {
      const open = !collapsed.has(n.id)
      rows.push(<ArchiveRow key={n.id} node={n} depth={depth} open={open} onToggle={() => toggle(n.id)} />)
      if (!open) continue
      if (n.completions?.length) {
        rows.push(<CompletionLog key={`log-${n.id}`} completions={n.completions} depth={depth + 1} />)
      }
      walk(n.children, depth + 1)
    }
  }
  walk(completed, 0)

  return (
    <div className="view completed-view">
      <div className="view-main">
        <header className="view-header">
          <div>
            <h1>Completed</h1>
            <p className="muted">
              {total} completed {total === 1 ? 'entry' : 'entries'} · greyed items are still open and shown
              for context
            </p>
          </div>
          {completed.length > 0 && (
            <div className="toolbar">
              <button type="button" className="btn ghost" onClick={() => setCollapsed(new Set())}>
                Expand all
              </button>
              <button type="button" className="btn ghost" onClick={collapseAll}>
                Collapse all
              </button>
            </div>
          )}
        </header>

        {completed.length === 0 ? (
          <div className="empty">
            <h2>Nothing completed yet</h2>
            <p className="muted">
              When you finish an item it moves here, in the same place in your hierarchy. Recurring tasks log
              each completed occurrence here too.
            </p>
          </div>
        ) : (
          <div className="tree-scroll">
            <div className="tree archive" role="tree">
              {rows}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ArchiveRow(props: {
  node: TaskNode
  depth: number
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const { node: n, depth, open } = props
  const forge = useForge()
  const expandable = n.children.length > 0 || (n.completions?.length ?? 0) > 0
  const done = n.status === 'done'

  return (
    <div
      role="treeitem"
      aria-expanded={expandable ? open : undefined}
      className={`tree-row archive-row depth-${depth}${n.isContext ? ' context' : ''}`}
      style={{ paddingLeft: 12 + depth * 22 }}
      onClick={() => expandable && props.onToggle()}
    >
      {expandable ? (
        <button
          type="button"
          className={`chevron${open ? ' open' : ''}`}
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation()
            props.onToggle()
          }}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
            <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <span className="chevron-spacer" />
      )}
      <span className={`archive-mark${done ? ' done' : ''}`} aria-label={done ? 'Done' : 'Open'}>
        {done && (
          <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden>
            <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
          </svg>
        )}
      </span>
      <LevelTag level={n.level} />
      <span className="tree-title">{n.title}</span>
      <span className="tree-meta">
        <RecurrenceTag recurrence={n.recurrence} />
        {done && n.completedAt && (
          <span className="completed-at" title={new Date(n.completedAt).toLocaleString()}>
            Completed {formatTimestamp(n.completedAt)}
          </span>
        )}
        {n.isContext && !done && n.completions?.length ? (
          <span className="completed-at">
            {n.completions.length} occurrence{n.completions.length === 1 ? '' : 's'} logged
          </span>
        ) : null}
        {done ? (
          <button
            type="button"
            className="btn reopen-btn"
            title="Move back to the active tree (also reopens done parents)"
            onClick={(e) => {
              e.stopPropagation()
              void forge.reopen(n)
            }}
          >
            Reopen
          </button>
        ) : (
          <span className="reopen-placeholder" />
        )}
      </span>
    </div>
  )
}

function CompletionLog(props: { completions: Completion[]; depth: number }): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const items = showAll ? props.completions : props.completions.slice(0, LOG_PREVIEW)
  const hidden = props.completions.length - items.length
  return (
    <div className="completion-log" style={{ paddingLeft: 12 + props.depth * 22 + 26 }}>
      {items.map((c) => (
        <div key={c.id} className="log-row">
          <span className="log-dot" aria-hidden />
          <span>Completed {formatTimestamp(c.completedAt)}</span>
          {c.occurrenceDate && (
            <span className="muted">
              · due{' '}
              {parseLocalDate(c.occurrenceDate).toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric'
              })}
            </span>
          )}
        </div>
      ))}
      {hidden > 0 && (
        <button type="button" className="link-btn" onClick={() => setShowAll(true)}>
          Show {hidden} older
        </button>
      )}
    </div>
  )
}
