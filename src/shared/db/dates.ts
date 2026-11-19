// Local-date helpers. Deadlines are calendar dates (YYYY-MM-DD) in the user's local time zone.
// Pure module: safe to import anywhere.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function toLocalDateString(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(date: string, days: number): string {
  const d = parseLocalDate(date)
  d.setDate(d.getDate() + days)
  return toLocalDateString(d)
}

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  return toLocalDateString(parseLocalDate(s)) === s
}

/** Whole days from `from` to `to` (positive if `to` is later). */
export function daysBetween(from: string, to: string): number {
  const ms = parseLocalDate(to).getTime() - parseLocalDate(from).getTime()
  return Math.round(ms / 86_400_000)
}
