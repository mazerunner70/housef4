import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { NetWorthHero } from '@/features/dashboard/components/NetWorthHero'
import { MonthlyCashFlowChart } from '@/features/dashboard/components/MonthlyCashFlowChart'
import { CategorySpendBreakdown } from '@/features/dashboard/components/CategorySpendBreakdown'
import { RecurringSubscriptionsList } from '@/features/dashboard/components/RecurringSubscriptionsList'
import { useAccounts } from '@/hooks/useAccounts'
import { useMetrics } from '@/hooks/useMetrics'
import { useTransactions } from '@/hooks/useTransactions'
import { useReviewQueue } from '@/hooks/useReviewQueue'
import {
  emptyMetrics,
  formatUtcMonthHeading,
  spendingByCategoryForUtcRange,
  utcMonthBoundsFromStart,
  utcMonthStartForCashflowLabel,
} from '@/lib/dashboardSpending'
import type { SpendingCategoryRow } from '@/lib/types'
import { cn } from '@/lib/cn'

export function DashboardPage() {
  const accountsQuery = useAccounts()
  const accountCurrencies = useMemo(() => {
    const codes = new Set<string>()
    for (const a of accountsQuery.data?.accounts ?? []) {
      const code = a.currency?.trim().toUpperCase()
      if (code) codes.add(code)
    }
    return [...codes].sort((a, b) => a.localeCompare(b))
  }, [accountsQuery.data?.accounts])

  const [preferredCurrency, setPreferredCurrency] = useState<string | undefined>()

  const selectedCurrency = useMemo((): string | undefined => {
    if (accountCurrencies.length === 0) return undefined
    if (
      preferredCurrency &&
      accountCurrencies.includes(preferredCurrency)
    ) {
      return preferredCurrency
    }
    return accountCurrencies[0]
  }, [accountCurrencies, preferredCurrency])

  const metricsQuery = useMetrics(selectedCurrency)
  const transactionsQuery = useTransactions()
  const reviewQuery = useReviewQueue()

  const [selectedCashflowMonthLabel, setSelectedCashflowMonthLabel] = useState<
    string | null
  >(null)

  const displayCurrency = selectedCurrency ?? 'USD'
  const metrics = metricsQuery.data ?? emptyMetrics(displayCurrency)
  const transactions = useMemo(() => {
    const all = transactionsQuery.data?.transactions ?? []
    const code = displayCurrency.trim().toUpperCase()
    return all.filter(
      (t) => t.currency?.trim().toUpperCase() === code,
    )
  }, [transactionsQuery.data, displayCurrency])

  const categoryPane = useMemo((): {
    categories: SpendingCategoryRow[]
    periodLabel: string
  } => {
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

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-zinc-500">
            Baseline view — net worth, cash flow, and category pacing.
          </p>
          <p className="mt-1 text-sm tabular-nums text-zinc-400">
            <span className="font-medium text-zinc-200">
              {metrics.transaction_count.toLocaleString()}
            </span>{' '}
            transactions in {metrics.currency}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {accountCurrencies.length > 1 && (
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <span>Currency</span>
              <select
                className="rounded-lg border border-white/[0.12] bg-zinc-900/80 px-3 py-1.5 text-sm text-zinc-100"
                value={displayCurrency}
                onChange={(e) => {
                  setPreferredCurrency(e.target.value)
                  setSelectedCashflowMonthLabel(null)
                }}
              >
                {accountCurrencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
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
            currency={metrics.currency}
            onClearMonthFilter={
              selectedCashflowMonthLabel === null
                ? undefined
                : clearCategoryMonth
            }
            className="min-h-[360px]"
          />
        </div>
      </div>

      <RecurringSubscriptionsList
        transactions={transactions}
        currency={metrics.currency}
      />
    </div>
  )
}
