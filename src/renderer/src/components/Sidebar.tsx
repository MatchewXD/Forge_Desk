// Same art as the window/taskbar icon (build/icon.ico), so the app has one logo.
import appIcon from '../../../../build/icon.png'

export type View = 'today' | 'tasks' | 'completed'

interface NavItem {
  id: View | 'board' | 'timeline' | 'assets'
  label: string
  icon: React.JSX.Element
  soon?: string
}

const icon = (d: string): React.JSX.Element => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const NAV: NavItem[] = [
  { id: 'today', label: 'Today', icon: icon('M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z') },
  { id: 'tasks', label: 'Tasks', icon: icon('M4 5h4M4 12h4M4 19h4M11 5h9M14 12h6M14 19h6M8 5v14') },
  { id: 'completed', label: 'Completed', icon: icon('M20 12a8 8 0 11-16 0 8 8 0 0116 0zM8.5 12.5l2.4 2.3 4.6-5') },
  { id: 'board', label: 'Board', icon: icon('M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z'), soon: 'Phase 2' },
  { id: 'timeline', label: 'Timeline', icon: icon('M4 6h10M8 12h12M4 18h8'), soon: 'Phase 2' },
  { id: 'assets', label: 'AI Assets', icon: icon('M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z'), soon: 'Phase 3' }
]

export function Sidebar(props: {
  view: View
  onNavigate: (v: View) => void
  counts: { overdue: number; today: number; completed: number }
}): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-mark" src={appIcon} alt="" width={30} height={30} draggable={false} />
        <span className="brand-name">Forge Desk</span>
      </div>
      <nav className="nav">
        {NAV.map((item) => {
          const active = item.id === props.view
          const disabled = Boolean(item.soon)
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item${active ? ' active' : ''}`}
              disabled={disabled}
              title={item.soon ? `Coming in ${item.soon}` : undefined}
              onClick={() => !disabled && props.onNavigate(item.id as View)}
            >
              {item.icon}
              <span className="nav-label">{item.label}</span>
              {item.id === 'today' && props.counts.overdue > 0 && (
                <span className="nav-badge danger" title="Overdue">{props.counts.overdue}</span>
              )}
              {item.id === 'today' && props.counts.today > 0 && (
                <span className="nav-badge" title="Due today">{props.counts.today}</span>
              )}
              {item.id === 'completed' && props.counts.completed > 0 && (
                <span className="nav-badge muted-badge" title="Completed items">{props.counts.completed}</span>
              )}
              {item.soon && <span className="nav-soon">{item.soon}</span>}
            </button>
          )
        })}
      </nav>
      <div className="sidebar-footer">v0.1 · Phase 1</div>
    </aside>
  )
}
