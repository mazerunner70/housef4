import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { NetWorthHero } from '@/features/dashboard/components/NetWorthHero'
import { MonthlyCashFlowChart } from '@/features/dashboard/components/MonthlyCashFlowChart'
import { CategorySpendBreakdown } from '@/features/dashboard/components/CategorySpendBreakdown'
import { RecurringSubscriptionsList } from '@/features/dashboard/components/RecurringSubscriptionsList'
import { Spinner } from '@/components/ui/Spinner'
import { useMetrics } from '@/hooks/useMetrics'
import { useTransactions } from '@/hooks/useTransactions'
import { useReviewQueue } from '@/hooks/useReviewQueue'
import {
  formatUtcMonthHeading,
  spendingByCategoryForUtcRange,
  utcMonthBoundsFromStart,
  utcMonthStartForCashflowLabel,
} from '@/lib/dashboardSpending'
import type { SpendingCategoryRow } from '@/lib/types'
import { cn } from '@/lib/cn'

export function DashboardPage() {
  const metricsQuery = useMetrics()
  const transactionsQuery = useTransactions()
  const reviewQuery = useReviewQueue()

  /** Axis label from `cashflow_history` — unique per month; avoids bad `month_start_ms` fallbacks. */
  const [selectedCashflowMonthLabel, setSelectedCashflowMonthLabel] = useState<
    string | null
  >(null)

  const metrics = metricsQuery.data
  const transactions = transactionsQuery.data?.transactions ?? []

  const categoryPane = useMemo((): {
    categories: SpendingCategoryRow[]
    periodLabel: string
  } => {
    if (!metrics) {
      return { categories: [], periodLabel: 'This month' }
    }
    if (selectedCashflowMonthLabel == null) {
      return {
        categories: metrics.spending_by_category,
        periodLabel: 'This month',
      }
    }
    const monthStart = utcMonthStartForCashflowLabel(
      metrics,
      selectedCashflowMonthLabel,
    )
    if (monthStart == null) {
      return {
        categories: [],
        periodLabel: selectedCashflowMonthLabel,
      }
    }
    const { start, end } = utcMonthBoundsFromStart(monthStart)
    return {
      categories: spendingByCategoryForUtcRange(transactions, start, end),
      periodLabel: formatUtcMonthHeading(monthStart),
    }
  }, [selectedCashflowMonthLabel, metrics, transactions])

  const clearCategoryMonth = useCallback(() => {
    setSelectedCashflowMonthLabel(null)
  }, [])

  const scheduleSelectCashflowMonth = useCallback((label: string) => {
    queueMicrotask(() => setSelectedCashflowMonthLabel(label))
  }, [])

  const pending = reviewQuery.data?.pending_clusters.length ?? 0

  if (metricsQuery.isPending || transactionsQuery.isPending) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <Spinner />
        <p className="text-sm text-zinc-500">Loading your dashboard…</p>
      </div>
    )
  }

  if (metricsQuery.isError || !metrics) {
    return (
      <p className="text-zinc-400">
        We couldn’t load metrics. Ensure the API is running and reachable (see
        Vite proxy for <code className="text-zinc-300">/api</code>).
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-zinc-500">
          Baseline view — net worth, cash flow, and category pacing.
        </p>
        <Link
          to="/review-queue"
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-nav-accent)]',
            pending > 0 &&
              'border-amber-500/40 text-amber-200 ui-pending-ring',
          )}
        >
          Review pending{pending > 0 ? ` (${pending})` : ''}
        </Link>
      </div>

      <NetWorthHero metrics={metrics} />

      <div className="grid gap-6 lg:grid-cols-3 lg:items-stretch">
        <div className="lg:col-span-2">
          <MonthlyCashFlowChart
            metrics={metrics}
            selectedMonthLabel={selectedCashflowMonthLabel}
            onSelectCashflowMonth={scheduleSelectCashflowMonth}
            className="h-full min-h-[360px]"
          />
        </div>
        <div className="lg:col-span-1">
          <CategorySpendBreakdown
            categories={categoryPane.categories}
            periodLabel={categoryPane.periodLabel}
            onClearMonthFilter={
              selectedCashflowMonthLabel === null
                ? undefined
                : clearCategoryMonth
            }
            className="min-h-[360px]"
          />
        </div>
      </div>

      <RecurringSubscriptionsList transactions={transactions} />
    </div>
  )
}
