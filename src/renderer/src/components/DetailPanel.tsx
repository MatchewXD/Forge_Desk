import { useEffect, useMemo, useState } from 'react'
import {
  ASSIGNEES,
  ASSIGNEE_LABELS,
  LEVEL_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  RECURRENCES,
  RECURRENCE_LABELS,
  RECURRING_LEVELS,
  STATUSES,
  STATUS_LABELS,
  childLevel,
  parentLevel,
  type Assignee,
  type Priority,
  type Recurrence,
  type Status,
  type TaskNode
} from '@shared/db/model.ts'
import { useForge } from '../store'
import { ancestorIds, countDescendants, type IndexedNode } from '../lib'
import { LevelTag, ProgressBar } from './Badges'
import { NotesLog } from './NotesLog'

interface Props {
  node: TaskNode
  index: Map<number, IndexedNode>
  onClose: () => void
  onSelect: (id: number) => void
  onAddChild: (id: number) => void
}

export function DetailPanel({ node, index, onClose, onSelect, onAddChild }: Props): React.JSX.Element {
  const forge = useForge()
  const [title, setTitle] = useState(node.title)
  const [description, setDescription] = useState(node.description)
  const [repoPath, setRepoPath] = useState(node.repoPath ?? '')

  // Resync local edits when another item is selected or the item changes underneath us.
  useEffect(() => {
    setTitle(node.title)
    setDescription(node.description)
    setRepoPath(node.repoPath ?? '')
  }, [node.id, node.title, node.description, node.repoPath])

  const ancestors = ancestorIds(index, node.id).map((id) => index.get(id)!.node)
  const parentLvl = parentLevel(node.level)
  const childLvl = childLevel(node.level)
  const siblings = useMemo(() => {
    const pid = index.get(node.id)?.parentId ?? null
    return pid == null
      ? [...index.values()].filter((e) => e.parentId === null).map((e) => e.node)
      : index.get(pid)!.node.children
  }, [index, node.id])
  const position = siblings.findIndex((s) => s.id === node.id)

  const moveTargets = useMemo(() => {
    if (!parentLvl) return []
    return [...index.values()]
      .filter((e) => e.node.level === parentLvl)
      .map((e) => ({
        id: e.node.id,
        label: [...ancestorIds(index, e.node.id).map((a) => index.get(a)!.node.title), e.node.title].join(' › ')
      }))
  }, [index, parentLvl])

  const saveTitle = (): void => {
    const t = title.trim()
    if (!t) return setTitle(node.title)
    if (t !== node.title) void forge.updateTask(node.id, { title: t })
  }
  const saveDescription = (): void => {
    if (description !== node.description) void forge.updateTask(node.id, { description })
  }
  const saveRepoPath = (): void => {
    const next = repoPath.trim() || null
    if (next === (node.repoPath ?? null)) return
    // On a rejected path (e.g. already used by another project) show the stored value again.
    void forge.updateTask(node.id, { repoPath: next }).then((ok) => {
      if (!ok) setRepoPath(node.repoPath ?? '')
    })
  }

  const remove = (): void => {
    const n = countDescendants(node)
    const msg =
      n > 0
        ? `Delete "${node.title}" and its ${n} sub-item(s)? This cannot be undone.`
        : `Delete "${node.title}"? This cannot be undone.`
    if (window.confirm(msg)) {
      void forge.deleteTask(node.id)
      onClose()
    }
  }

  return (
    <aside className="detail" aria-label="Item details">
      <header className="detail-header">
        <LevelTag level={node.level} />
        <div className="detail-crumbs">
          {ancestors.map((a) => (
            <button key={a.id} type="button" className="crumb" onClick={() => onSelect(a.id)}>
              {a.title}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </header>

      <textarea
        className="detail-title"
        rows={1}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLTextAreaElement).blur()
          }
          if (e.key === 'Escape') setTitle(node.title)
        }}
      />

      {node.children.length > 0 && (
        <div className="detail-progress">
          <ProgressBar progress={node.progress} />
          <span className="muted">
            {node.leafDone} of {node.leafCount} done
          </span>
        </div>
      )}

      <div className="field-grid">
        <label className="field">
          <span>Status</span>
          <select
            value={node.status}
            onChange={(e) => {
              const status = e.target.value as Status
              if (status === 'done') {
                const cascade =
                  !node.recurrence &&
                  node.children.length > 0 &&
                  node.leafCount - node.leafDone > 0 &&
                  window.confirm('Also mark all open sub-items as done?')
                void forge.complete(node, cascade)
              } else {
                void forge.updateTask(node.id, { status })
              }
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Priority</span>
          <select
            value={node.priority}
            onChange={(e) => void forge.updateTask(node.id, { priority: e.target.value as Priority })}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Assignee</span>
          <select
            value={node.assignee}
            onChange={(e) => void forge.updateTask(node.id, { assignee: e.target.value as Assignee })}
          >
            {ASSIGNEES.map((a) => (
              <option key={a} value={a}>
                {ASSIGNEE_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Deadline</span>
          <div className="date-row">
            <input
              type="date"
              value={node.deadline ?? ''}
              onChange={(e) => void forge.updateTask(node.id, { deadline: e.target.value || null })}
            />
            {node.deadline && (
              <button
                type="button"
                className="icon-btn"
                title="Clear deadline"
                onClick={() => void forge.updateTask(node.id, { deadline: null })}
              >
                ×
              </button>
            )}
          </div>
        </label>
        {RECURRING_LEVELS.includes(node.level) && (
          <label className="field">
            <span>Repeats</span>
            <select
              value={node.recurrence ?? ''}
              onChange={(e) =>
                void forge.updateTask(node.id, { recurrence: (e.target.value || null) as Recurrence | null })
              }
            >
              <option value="">Never</option>
              {RECURRENCES.map((r) => (
                <option key={r} value={r}>
                  {RECURRENCE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
        )}
        {parentLvl && (
          <label className="field">
            <span>Parent {LEVEL_LABELS[parentLvl].toLowerCase()}</span>
            <select
              value={index.get(node.id)?.parentId ?? ''}
              onChange={(e) => void forge.moveTask(node.id, Number(e.target.value))}
            >
              {moveTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {node.level === 'project' && (
        <label className="field">
          <span>Repo path</span>
          <input
            type="text"
            spellCheck={false}
            placeholder="e.g. E:\Coding\My_Repo (for /next-task in Claude Code)"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            onBlur={saveRepoPath}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setRepoPath(node.repoPath ?? '')
            }}
          />
        </label>
      )}

      {node.recurrence && (
        <p className="recur-hint muted">
          Completing this logs the occurrence to Completed and moves the deadline to the next{' '}
          {node.recurrence === 'weekly' ? 'week' : node.recurrence === 'weekdays' ? 'weekday' : 'day'}
          {node.children.length > 0 ? '; its sub-items reset each time.' : '.'}
        </p>
      )}

      <label className="field">
        <span>Description</span>
        <textarea
          className="detail-desc"
          placeholder="Add notes, context, links…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
        />
      </label>

      <NotesLog taskId={node.id} />

      <div className="detail-actions">
        {childLvl && (
          <button type="button" className="btn primary" onClick={() => onAddChild(node.id)}>
            + Add {LEVEL_LABELS[childLvl].toLowerCase()}
          </button>
        )}
        <div className="btn-group">
          <button
            type="button"
            className="btn"
            disabled={position <= 0}
            title="Move up"
            onClick={() => void forge.moveTask(node.id, index.get(node.id)?.parentId ?? null, position - 1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn"
            disabled={position < 0 || position >= siblings.length - 1}
            title="Move down"
            onClick={() => void forge.moveTask(node.id, index.get(node.id)?.parentId ?? null, position + 1)}
          >
            ↓
          </button>
        </div>
        <span className="spacer" />
        <button type="button" className="btn danger" onClick={remove}>
          Delete
        </button>
      </div>

      <footer className="detail-footer muted">
        Created {new Date(node.createdAt).toLocaleDateString()}
        {node.completedAt && ` · Completed ${new Date(node.completedAt).toLocaleDateString()}`}
      </footer>
    </aside>
  )
}
