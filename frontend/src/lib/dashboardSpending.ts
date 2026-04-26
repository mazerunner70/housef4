import type { MetricsResponse, SpendingCategoryRow, Transaction } from '@/lib/types'

export function utcMonthBoundsFromStart(monthStartMs: number): {
  start: number
  end: number
} {
  const d = new Date(monthStartMs)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  return {
    start: Date.UTC(y, m, 1, 0, 0, 0, 0),
    end: Date.UTC(y, m + 1, 0, 23, 59, 59, 999),
  }
}

export function spendingByCategoryForUtcRange(
  transactions: Transaction[],
  start: number,
  end: number,
): SpendingCategoryRow[] {
  const categoryTotals = new Map<string, number>()
  for (const t of transactions) {
    if (t.date < start || t.date > end) continue
    if (t.amount < 0) {
      const cat = t.category || 'Uncategorized'
      categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + -t.amount)
    }
  }
  return [...categoryTotals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
}

/** Matches server `monthLabelUtc` / chart axis labels (en-US short month, UTC). */
export function formatUtcMonthHeading(monthStartMs: number): string {
  return new Date(monthStartMs).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Fallback when `month_start_ms` is missing on an older API payload. */
/** Resolves UTC month start for a cash-flow history row, for client-side aggregates. */
export function utcMonthStartForCashflowLabel(
  metrics: Pick<MetricsResponse, 'cashflow_history'>,
  label: string,
): number | null {
  const row = metrics.cashflow_history?.find((h) => h.label === label)
  if (
    row?.month_start_ms != null &&
    Number.isFinite(row.month_start_ms)
  ) {
    return row.month_start_ms
  }
  return monthStartMsFromCashflowLabel(label)
}

export function monthStartMsFromCashflowLabel(label: string): number | null {
  const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec(label.trim())
  if (!m) return null
  const raw = m[1]
  const short =
    raw.slice(0, 1).toUpperCase() + raw.slice(1).toLowerCase()
  const monthIx = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ].indexOf(short)
  if (monthIx < 0) return null
  const year = Number(m[2])
  if (!Number.isFinite(year)) return null
  return Date.UTC(year, monthIx, 1, 0, 0, 0, 0)
}
