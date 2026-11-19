import { useState } from 'react'
import { LEVEL_LABELS, childLevel, type Level, type TaskNode } from '@shared/db/model.ts'
import { useForge } from '../store'
import {
  AssigneeTag,
  CheckButton,
  DeadlineChip,
  LevelTag,
  PriorityDot,
  ProgressBar,
  RecurrenceTag
} from './Badges'

export type AddTarget = number | 'root' | null

interface Props {
  roots: TaskNode[]
  today: string
  expanded: Set<number>
  onToggleExpand: (id: number) => void
  selectedId: number | null
  onSelect: (id: number) => void
  addTarget: AddTarget
  onAddTarget: (t: AddTarget) => void
}

export function TaskTree(props: Props): React.JSX.Element {
  const rows: React.JSX.Element[] = []

  const walk = (nodes: TaskNode[], depth: number): void => {
    for (const n of nodes) {
      const open = props.expanded.has(n.id)
      rows.push(<TreeRow key={n.id} node={n} depth={depth} open={open} {...props} />)
      if (open || props.addTarget === n.id) {
        if (open) walk(n.children, depth + 1)
        if (props.addTarget === n.id) {
          rows.push(
            <AddRow
              key={`add-${n.id}`}
              depth={depth + 1}
              parentId={n.id}
              level={childLevel(n.level)!}
              onClose={() => props.onAddTarget(null)}
            />
          )
        }
      }
    }
  }
  walk(props.roots, 0)

  if (props.addTarget === 'root') {
    rows.push(
      <AddRow key="add-root" depth={0} parentId={null} level="vision" onClose={() => props.onAddTarget(null)} />
    )
  }

  return (
    <div className="tree" role="tree">
      {rows}
    </div>
  )
}

function TreeRow(props: Props & { node: TaskNode; depth: number; open: boolean }): React.JSX.Element {
  const { node: n, depth, open } = props
  const forge = useForge()
  const hasChildren = n.children.length > 0
  const done = n.status === 'done'
  const canHaveChildren = childLevel(n.level) !== null
  const openDescendants = n.leafCount - n.leafDone

  const toggleDone = (): void => {
    // A done row in the active tree is context for open descendants: clicking reopens it.
    if (done) return void forge.reopen(n)
    if (!n.recurrence && hasChildren && openDescendants > 0) {
      const ok = window.confirm(
        `Mark "${n.title}" and its ${openDescendants} open sub-item(s) as done?`
      )
      if (!ok) return
      void forge.complete(n, true)
    } else {
      void forge.complete(n)
    }
  }

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? open : undefined}
      aria-selected={props.selectedId === n.id}
      className={`tree-row depth-${depth}${props.selectedId === n.id ? ' selected' : ''}${n.isContext ? ' context' : ''}`}
      style={{ paddingLeft: 12 + depth * 22 }}
      onClick={() => props.onSelect(n.id)}
      onDoubleClick={() => hasChildren && props.onToggleExpand(n.id)}
    >
      {hasChildren ? (
        <button
          type="button"
          className={`chevron${open ? ' open' : ''}`}
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation()
            props.onToggleExpand(n.id)
          }}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
            <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <span className="chevron-spacer" />
      )}
      <CheckButton
        checked={done}
        onToggle={toggleDone}
        title={done ? 'Done — click to reopen' : n.recurrence ? 'Complete this occurrence' : undefined}
      />
      <LevelTag level={n.level} />
      <span className="tree-title">{n.title}</span>
      {n.status === 'in_progress' && <span className="mini-status in_progress">In progress</span>}
      {n.status === 'blocked' && <span className="mini-status blocked">Blocked</span>}
      {n.status === 'review' && <span className="mini-status review">Review</span>}
      <AssigneeTag assignee={n.assignee} />
      <span className="tree-meta">
        <RecurrenceTag recurrence={n.recurrence} compact />
        <DeadlineChip deadline={n.deadline} today={props.today} done={done} />
        <PriorityDot priority={n.priority} />
        <span className="tree-progress">
          {hasChildren ? (
            <>
              <ProgressBar progress={n.progress} />
              <span className="leaf-count">
                {n.leafDone}/{n.leafCount}
              </span>
            </>
          ) : null}
        </span>
        {canHaveChildren ? (
          <button
            type="button"
            className="row-add"
            title={`Add ${LEVEL_LABELS[childLevel(n.level)!]}`}
            onClick={(e) => {
              e.stopPropagation()
              props.onAddTarget(n.id)
            }}
          >
            +
          </button>
        ) : (
          <span className="row-add placeholder" />
        )}
      </span>
    </div>
  )
}

function AddRow(props: {
  depth: number
  parentId: number | null
  level: Level
  onClose: () => void
}): React.JSX.Element {
  const forge = useForge()
  const [title, setTitle] = useState('')

  const submit = async (): Promise<void> => {
    const t = title.trim()
    if (!t) return props.onClose()
    await forge.createTask({ parentId: props.parentId, level: props.level, title: t })
    setTitle('') // stay open for rapid entry
  }

  return (
    <div className="tree-row add-row" style={{ paddingLeft: 12 + props.depth * 22 + 22 }}>
      <LevelTag level={props.level} />
      <input
        autoFocus
        className="add-input"
        placeholder={`New ${LEVEL_LABELS[props.level].toLowerCase()} — Enter to add, Esc to close`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') props.onClose()
        }}
        onBlur={() => !title.trim() && props.onClose()}
      />
    </div>
  )
}
