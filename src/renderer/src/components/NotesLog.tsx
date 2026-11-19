import { useEffect, useRef, useState } from 'react'
import { ASSIGNEE_LABELS, type Note } from '@shared/db/model.ts'
import { useForge } from '../store'

/** Append-only notes for one item: oldest first, with a box to add another as "me". */
export function NotesLog({ taskId }: { taskId: number }): React.JSX.Element {
  const forge = useForge()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)

  // Refetch when the selection changes or any data refresh happens (incl. notes added via MCP).
  useEffect(() => {
    let live = true
    forge
      .listNotes(taskId)
      .then((n) => live && setNotes(n))
      .catch(() => live && setNotes([]))
    return () => {
      live = false
    }
  }, [taskId, forge.version])

  // Clear the draft only when switching items.
  useEffect(() => setDraft(''), [taskId])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [notes])

  const submit = async (): Promise<void> => {
    if (!draft.trim() || saving) return
    setSaving(true)
    const ok = await forge.addNote(taskId, draft)
    setSaving(false)
    if (ok) setDraft('')
  }

  return (
    <section className="notes" aria-label="Notes">
      <div className="notes-head">
        <span className="field-label">Notes</span>
        {notes && notes.length > 0 && <span className="count">{notes.length}</span>}
      </div>
      {notes && notes.length > 0 ? (
        <ol className="notes-list" ref={listRef}>
          {notes.map((n) => (
            <li key={n.id} className={`note author-${n.author}`}>
              <div className="note-meta">
                <span className="note-author">{ASSIGNEE_LABELS[n.author]}</span>
                <time dateTime={n.createdAt} title={new Date(n.createdAt).toLocaleString()}>
                  {formatNoteTime(n.createdAt)}
                </time>
              </div>
              <div className="note-text">{n.text}</div>
            </li>
          ))}
        </ol>
      ) : (
        notes && <p className="muted notes-empty">No notes yet. Notes can’t be edited once added.</p>
      )}
      <div className="note-compose">
        <textarea
          placeholder="Add a note… (Ctrl+Enter to add)"
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <button type="button" className="btn" disabled={!draft.trim() || saving} onClick={() => void submit()}>
          Add note
        </button>
      </div>
    </section>
  )
}

function formatNoteTime(iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
