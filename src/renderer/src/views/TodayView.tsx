import type { TaskWithPath } from '@shared/db/model.ts'
import { useForge } from '../store'
import { longDate } from '../lib'
import { CheckButton, DeadlineChip, LevelTag, PriorityDot } from '../components/Badges'

export function TodayView(props: { onOpenTask: (id: number) => void }): React.JSX.Element {
  const { today: view, tree } = useForge()
  if (!view) return <div className="view" />

  const total = view.overdue.length + view.dueToday.length + view.upcoming.length

  // Group upcoming items by date.
  const upcomingByDate = new Map<string, TaskWithPath[]>()
  for (const t of view.upcoming) {
    const list = upcomingByDate.get(t.deadline!) ?? []
    list.push(t)
    upcomingByDate.set(t.deadline!, list)
  }

  return (
    <div className="view today-view">
      <div className="view-main">
        <header className="view-header">
          <div>
            <h1>Today</h1>
            <p className="muted">{longDate(view.today)}</p>
          </div>
          <div className="stat-row">
            <Stat label="Overdue" value={view.overdue.length} tone="danger" />
            <Stat label="Due today" value={view.dueToday.length} tone="accent" />
            <Stat label="Next 7 days" value={view.upcoming.length} />
          </div>
        </header>

        <div className="today-scroll">
          {total === 0 ? (
            <div className="empty">
              <h2>{tree.length === 0 ? 'Nothing here yet' : 'All clear'}</h2>
              <p className="muted">
                {tree.length === 0
                  ? 'Create a vision in Tasks and give items deadlines — they will show up here.'
                  : 'Nothing overdue or due in the next 7 days.'}
              </p>
            </div>
          ) : (
            <>
              {view.overdue.length > 0 && (
                <Section title="Overdue" tone="danger" items={view.overdue} today={view.today} onOpen={props.onOpenTask} />
              )}
              <Section
                title="Due today"
                tone="accent"
                items={view.dueToday}
                today={view.today}
                onOpen={props.onOpenTask}
                emptyText="Nothing due today."
              />
              <section className="today-section">
                <h2 className="section-title">
                  Next 7 days <span className="count">{view.upcoming.length}</span>
                </h2>
                {view.upcoming.length === 0 && <p className="muted section-empty">Nothing scheduled.</p>}
                {[...upcomingByDate].map(([date, items]) => (
                  <div key={date} className="date-group">
                    <h3 className="date-heading">{longDate(date)}</h3>
                    {items.map((t) => (
                      <TodayRow key={t.id} task={t} today={view.today} onOpen={props.onOpenTask} />
                    ))}
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat(props: { label: string; value: number; tone?: 'danger' | 'accent' }): React.JSX.Element {
  return (
    <div className={`stat${props.tone && props.value > 0 ? ` ${props.tone}` : ''}`}>
      <span className="stat-value">{props.value}</span>
      <span className="stat-label">{props.label}</span>
    </div>
  )
}

function Section(props: {
  title: string
  tone: 'danger' | 'accent'
  items: TaskWithPath[]
  today: string
  onOpen: (id: number) => void
  emptyText?: string
}): React.JSX.Element {
  return (
    <section className={`today-section tone-${props.tone}`}>
      <h2 className="section-title">
        {props.title} <span className="count">{props.items.length}</span>
      </h2>
      {props.items.length === 0 && props.emptyText && <p className="muted section-empty">{props.emptyText}</p>}
      {props.items.map((t) => (
        <TodayRow key={t.id} task={t} today={props.today} onOpen={props.onOpen} />
      ))}
    </section>
  )
}

function TodayRow(props: { task: TaskWithPath; today: string; onOpen: (id: number) => void }): React.JSX.Element {
  const { task: t } = props
  const forge = useForge()
  return (
    <div className="today-row" onClick={() => props.onOpen(t.id)} title="Open in Tasks">
      <CheckButton checked={false} onToggle={() => void forge.setDone(t.id, true)} />
      <div className="today-main">
        <div className="today-title">
          {t.title}
          {t.status === 'in_progress' && <span className="mini-status in_progress">In progress</span>}
          {t.status === 'blocked' && <span className="mini-status blocked">Blocked</span>}
        </div>
        {t.path.length > 0 && <div className="today-path">{t.path.join(' › ')}</div>}
      </div>
      <LevelTag level={t.level} />
      <PriorityDot priority={t.priority} />
      <DeadlineChip deadline={t.deadline} today={props.today} />
    </div>
  )
}
