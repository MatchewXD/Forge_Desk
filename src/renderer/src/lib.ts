import type { TaskNode } from '@shared/db/model.ts'
import { daysBetween, parseLocalDate } from '@shared/db/dates.ts'

export interface IndexedNode {
  node: TaskNode
  parentId: number | null
  depth: number
}

export function indexTree(roots: TaskNode[]): Map<number, IndexedNode> {
  const map = new Map<number, IndexedNode>()
  const walk = (nodes: TaskNode[], parentId: number | null, depth: number): void => {
    for (const n of nodes) {
      map.set(n.id, { node: n, parentId, depth })
      walk(n.children, n.id, depth + 1)
    }
  }
  walk(roots, null, 0)
  return map
}

export function ancestorIds(index: Map<number, IndexedNode>, id: number): number[] {
  const out: number[] = []
  let p = index.get(id)?.parentId ?? null
  while (p != null) {
    out.unshift(p)
    p = index.get(p)?.parentId ?? null
  }
  return out
}

export function countDescendants(n: TaskNode): number {
  return n.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0)
}

export type DeadlineTone = 'overdue' | 'today' | 'soon' | 'later' | 'done'

export function deadlineInfo(
  deadline: string,
  today: string,
  done = false
): { label: string; tone: DeadlineTone } {
  const diff = daysBetween(today, deadline)
  const date = parseLocalDate(deadline)
  const short = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (done) return { label: short, tone: 'done' }
  if (diff < 0) return { label: diff === -1 ? 'Yesterday' : `${-diff}d overdue`, tone: 'overdue' }
  if (diff === 0) return { label: 'Today', tone: 'today' }
  if (diff === 1) return { label: 'Tomorrow', tone: 'soon' }
  if (diff < 7) {
    return { label: date.toLocaleDateString(undefined, { weekday: 'short' }), tone: 'soon' }
  }
  const sameYear = date.getFullYear() === parseLocalDate(today).getFullYear()
  return {
    label: sameYear
      ? short
      : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    tone: 'later'
  }
}

export function longDate(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  })
}

export function pct(progress: number): string {
  return `${Math.round(progress * 100)}%`
}
