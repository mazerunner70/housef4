import { useMemo, type CSSProperties } from 'react'
import {
  Bus,
  Home,
  PiggyBank,
  ShoppingBag,
  Trophy,
  type LucideIcon,
} from 'lucide-react'

import type { SpendingCategoryRow } from '@/lib/types'
import { cn } from '@/lib/cn'
import { theme } from '@/lib/theme'

type CategorySpendBreakdownProps = {
  categories: SpendingCategoryRow[]
  periodLabel: string
  onClearMonthFilter?: () => void
  className?: string
}

type RowTheme = {
  icon: LucideIcon
  bar: string
  glowIndex: number
  iconBg: string
}

const ROW_THEMES: RowTheme[] = [
  {
    icon: Home,
    bar: 'bg-violet-500',
    glowIndex: 0,
    iconBg: 'bg-violet-500/20 text-violet-300',
  },
  {
    icon: ShoppingBag,
    bar: 'bg-cyan-400',
    glowIndex: 1,
    iconBg: 'bg-cyan-500/20 text-cyan-300',
  },
  {
    icon: Trophy,
    bar: 'bg-emerald-400',
    glowIndex: 2,
    iconBg: 'bg-emerald-500/20 text-emerald-300',
  },
  {
    icon: Bus,
    bar: 'bg-teal-500',
    glowIndex: 3,
    iconBg: 'bg-teal-500/20 text-teal-300',
  },
  {
    icon: PiggyBank,
    bar: 'bg-lime-400',
    glowIndex: 4,
    iconBg: 'bg-lime-500/20 text-lime-300',
  },
]

function shortLabel(full: string): string {
  if (full.startsWith('Housing')) return 'Housing'
  if (full.startsWith('Food')) return 'Groceries'
  if (full.startsWith('Discretionary')) return 'Discretionary'
  if (full.startsWith('Transportation')) return 'Transportation'
  if (full.includes('Savings') || full.includes('Wealth')) return 'Savings'
  return full.split('&')[0]?.trim() ?? full
}

export function CategorySpendBreakdown({
  categories,
  periodLabel,
  onClearMonthFilter,
  className,
}: CategorySpendBreakdownProps) {
  const rows = useMemo(() => {
    const sorted = [...categories].sort((a, b) => b.amount - a.amount)
    const picked = sorted.slice(0, 5)
    const maxAmt = picked[0]?.amount ?? 0
    return picked.map((row, i) => {
      const rowTheme = ROW_THEMES[i % ROW_THEMES.length]
      const budget = row.budget
      const pct =
        budget != null && budget > 0
          ? Math.min(100, (row.amount / budget) * 100)
          : maxAmt > 0
            ? Math.min(100, (row.amount / maxAmt) * 100)
            : 0
      return { row, rowTheme, pct, label: shortLabel(row.category) }
    })
  }, [categories])

  return (
    <section
      className={cn(
        'glass-panel flex h-full flex-col rounded-3xl p-6 text-left',
        className,
      )}
    >
      <header className="mb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-white">
            Spending by Category
          </h2>
          {onClearMonthFilter ? (
            <button
              type="button"
              onClick={onClearMonthFilter}
              className="text-xs font-medium text-zinc-500 underline decoration-zinc-600 underline-offset-2 transition hover:text-zinc-300"
            >
              Back to this month
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-zinc-500">{periodLabel}</p>
      </header>
      <ul className="flex flex-1 flex-col gap-5">
        {rows.map(({ row, rowTheme, pct, label }) => {
          const Icon = rowTheme.icon
          const glow = theme.categoryGlow[rowTheme.glowIndex]
          const fillStyle: CSSProperties = {
            width: `${pct}%`,
            boxShadow: `0 0 14px ${glow}, 0 0 4px ${glow}`,
          }
          const budget = row.budget
          const hasBudget = budget != null && budget > 0
          return (
            <li key={row.category}>
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-xl',
                    rowTheme.iconBg,
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium text-zinc-200">
                      {label}
                    </span>
                    <span className="shrink-0 tabular-nums text-zinc-400">
                      {row.amount.toLocaleString(undefined, {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 0,
                      })}
                      {hasBudget ? (
                        <>
                          {' '}
                          <span className="text-zinc-600">/</span>{' '}
                          {budget.toLocaleString(undefined, {
                            style: 'currency',
                            currency: 'USD',
                            maximumFractionDigits: 0,
                          })}
                        </>
                      ) : null}
                    </span>
                  </div>
                  <div
                    className="mt-2 h-2 overflow-hidden rounded-full bg-white/5"
                    role="progressbar"
                    aria-valuenow={Math.round(pct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={
                      hasBudget
                        ? `${label} spending versus budget`
                        : `${label} share of top spending`
                    }
                  >
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width] duration-500',
                        rowTheme.bar,
                      )}
                      style={fillStyle}
                    />
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
