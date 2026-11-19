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

function isWeekend(date: string): boolean {
  const day = parseLocalDate(date).getDay()
  return day === 0 || day === 6
}

type RecurrenceRule = 'daily' | 'weekdays' | 'weekly'

function step(rule: RecurrenceRule, date: string): string {
  if (rule === 'weekly') return addDays(date, 7)
  let next = addDays(date, 1)
  if (rule === 'weekdays') while (isWeekend(next)) next = addDays(next, 1)
  return next
}

/** First due date for a newly recurring item that has no deadline: today (next weekday for 'weekdays'). */
export function firstOccurrence(rule: RecurrenceRule, today: string): string {
  let d = today
  if (rule === 'weekdays') while (isWeekend(d)) d = addDays(d, 1)
  return d
}

/**
 * Next due date after completing the occurrence due on `from`. Steps forward by the rule until
 * the date is after `today`, so a missed streak doesn't leave the next occurrence already overdue
 * and an early completion moves to the following period. Weekly keeps the same weekday.
 */
export function nextOccurrence(rule: RecurrenceRule, from: string, today: string): string {
  let d = step(rule, from)
  while (d <= today) d = step(rule, d)
  return d
}

/** Whole days from `from` to `to` (positive if `to` is later). */
export function daysBetween(from: string, to: string): number {
  const ms = parseLocalDate(to).getTime() - parseLocalDate(from).getTime()
  return Math.round(ms / 86_400_000)
}
