import {
  LEVEL_LABELS,
  PRIORITY_LABELS,
  RECURRENCE_LABELS,
  STATUS_LABELS,
  type Level,
  type Priority,
  type Recurrence,
  type Status
} from '@shared/db/model.ts'
import { deadlineInfo, pct } from '../lib'

export function LevelTag({ level }: { level: Level }): React.JSX.Element {
  return <span className={`level-tag level-${level}`}>{LEVEL_LABELS[level]}</span>
}

export function RecurrenceTag({
  recurrence,
  compact
}: {
  recurrence: Recurrence | null
  /** Icon only (label in tooltip) */
  compact?: boolean
}): React.JSX.Element | null {
  if (!recurrence) return null
  return (
    <span className={`recur-tag${compact ? ' compact' : ''}`} title={`Repeats ${RECURRENCE_LABELS[recurrence].toLowerCase()}`}>
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden>
        <path
          d="M13 6.5A5 5 0 0 0 3.6 5M3 9.5A5 5 0 0 0 12.4 11M3.4 2.5V5.2H6M12.6 13.5V10.8H10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {!compact && RECURRENCE_LABELS[recurrence]}
    </span>
  )
}

export function PriorityDot({ priority }: { priority: Priority }): React.JSX.Element {
  return (
    <span
      className={`priority-dot priority-${priority}`}
      title={`${PRIORITY_LABELS[priority]} priority`}
    />
  )
}

export function StatusPill({ status }: { status: Status }): React.JSX.Element {
  return <span className={`status-pill status-${status}`}>{STATUS_LABELS[status]}</span>
}

export function DeadlineChip(props: {
  deadline: string | null
  today: string
  done?: boolean
}): React.JSX.Element | null {
  if (!props.deadline) return null
  const { label, tone } = deadlineInfo(props.deadline, props.today, props.done)
  return (
    <span className={`deadline-chip tone-${tone}`} title={props.deadline}>
      {label}
    </span>
  )
}

export function ProgressBar(props: { progress: number; showLabel?: boolean }): React.JSX.Element {
  const complete = props.progress >= 1
  return (
    <span className="progress">
      <span className="progress-track">
        <span
          className={`progress-fill${complete ? ' complete' : ''}`}
          style={{ width: pct(props.progress) }}
        />
      </span>
      {props.showLabel !== false && <span className="progress-label">{pct(props.progress)}</span>}
    </span>
  )
}

/** Round checkbox used in tree and Today rows. */
export function CheckButton(props: {
  checked: boolean
  onToggle: () => void
  title?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`check${props.checked ? ' checked' : ''}`}
      title={props.title ?? (props.checked ? 'Mark as not done' : 'Mark as done')}
      aria-pressed={props.checked}
      onClick={(e) => {
        e.stopPropagation()
        props.onToggle()
      }}
    >
      {props.checked && (
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden>
          <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
        </svg>
      )}
    </button>
  )
}
