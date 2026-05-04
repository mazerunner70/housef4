import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Spinner } from '@/components/ui/Spinner'
import { useTransactionsByImportFile } from '@/hooks/useTransactions'
import type { Transaction } from '@/lib/types'
import { cn } from '@/lib/cn'

type ViewMode = 'date' | 'cluster' | 'category'
type DateOrder = 'asc' | 'desc'

const money = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function shortClusterLabel(clusterId: string): string {
  if (clusterId.length <= 14) return clusterId
  return `${clusterId.slice(0, 8)}…${clusterId.slice(-4)}`
}

function groupByCategoryThenCluster(
  txs: Transaction[],
): Map<string, Map<string, Transaction[]>> {
  const byCat = new Map<string, Map<string, Transaction[]>>()
  for (const t of txs) {
    const cat = t.category.trim() || 'Uncategorized'
    let byCluster = byCat.get(cat)
    if (!byCluster) {
      byCluster = new Map()
      byCat.set(cat, byCluster)
    }
    const list = byCluster.get(t.cluster_id) ?? []
    list.push(t)
    byCluster.set(t.cluster_id, list)
  }
  for (const m of byCat.values()) {
    for (const list of m.values()) {
      list.sort((a, b) => a.date - b.date)
    }
  }
  return byCat
}

function groupByCluster(
  txs: Transaction[],
): Map<string, Transaction[]> {
  const m = new Map<string, Transaction[]>()
  for (const t of txs) {
    const list = m.get(t.cluster_id) ?? []
    list.push(t)
    m.set(t.cluster_id, list)
  }
  for (const list of m.values()) {
    list.sort((a, b) => a.date - b.date)
  }
  return m
}

function TransactionRow({
  t,
  showCategory,
}: Readonly<{ t: Transaction; showCategory: boolean }>) {
  const hasCategory = t.category.trim().length > 0
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
      <span className="min-w-0 text-zinc-400">
        <time
          dateTime={new Date(t.date).toISOString()}
          className="tabular-nums text-zinc-500"
        >
          {new Date(t.date).toLocaleDateString()}
        </time>
        <span className="mx-2 text-zinc-600">·</span>
        <span className="text-zinc-200">{t.raw_merchant}</span>
        {showCategory && hasCategory && (
          <span className="mt-0.5 block text-xs text-zinc-500">
            {t.category}
          </span>
        )}
      </span>
      <span
        className={
          t.amount < 0
            ? 'tabular-nums text-zinc-300'
            : 'tabular-nums text-emerald-400/90'
        }
      >
        {money.format(t.amount)}
      </span>
    </li>
  )
}

function ToggleButton({
  pressed,
  onClick,
  children,
}: Readonly<{
  pressed: boolean
  onClick: () => void
  children: ReactNode
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        'rounded-full border px-3 py-1.5 text-sm font-medium transition',
        pressed
          ? 'border-[var(--color-nav-accent)] bg-[var(--color-accent-soft)] text-zinc-100'
          : 'border-[var(--color-border)] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]',
      )}
    >
      {children}
    </button>
  )
}

export function ImportTransactionsReviewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [viewMode, setViewMode] = useState<ViewMode>('category')
  const [dateOrder, setDateOrder] = useState<DateOrder>('asc')

  const transactionFileId =
    searchParams.get('transactionFileId')?.trim() || undefined

  const query = useTransactionsByImportFile(transactionFileId)

  const batch = useMemo(
    () => query.data?.transactions ?? [],
    [query.data],
  )

  const sortedByDate = useMemo(() => {
    const copy = [...batch]
    copy.sort((a, b) =>
      dateOrder === 'asc' ? a.date - b.date : b.date - a.date,
    )
    return copy
  }, [batch, dateOrder])

  const hierarchy = useMemo(
    () => groupByCategoryThenCluster(batch),
    [batch],
  )

  const byCluster = useMemo(() => groupByCluster(batch), [batch])

  const categories = useMemo(
    () =>
      [...hierarchy.keys()].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }),
      ),
    [hierarchy],
  )

  const clusterEntries = useMemo(() => {
    return [...byCluster.entries()].sort((a, b) => {
      const ma = a[1][0]?.cleaned_merchant ?? ''
      const mb = b[1][0]?.cleaned_merchant ?? ''
      return ma.localeCompare(mb) || a[0].localeCompare(b[0])
    })
  }, [byCluster])

  if (!transactionFileId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-zinc-100">
          Import transaction review
        </h1>
        <p className="max-w-xl text-zinc-400">
          Open this view from the Import page after an upload, from import
          history, or via &quot;Review last import&quot; so the URL includes a{' '}
          <code className="text-zinc-300">transactionFileId</code> query parameter.
        </p>
        <Link
          to="/import"
          className="inline-flex rounded-full border border-[var(--color-border)] bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.08]"
        >
          Go to Import
        </Link>
      </div>
    )
  }

  if (query.isPending) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <Spinner />
        <p className="text-sm text-zinc-500">Loading transactions…</p>
      </div>
    )
  }

  if (query.isError || !query.data) {
    return (
      <p className="text-zinc-400">
        {query.error instanceof Error
          ? query.error.message
          : 'Could not load transactions.'}
      </p>
    )
  }

  if (batch.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-zinc-100">
          Import transaction review
        </h1>
        <p className="max-w-xl text-zinc-400">
          No transactions for this import file. The run may have ingested zero
          new rows, or the file id does not match any stored rows.
        </p>
        <Link
          to="/import"
          className="inline-flex rounded-full border border-[var(--color-border)] bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.08]"
        >
          Go to Import
        </Link>
      </div>
    )
  }

  let subtitle: string
  if (viewMode === 'date') {
    const order = dateOrder === 'asc' ? 'oldest first' : 'newest first'
    subtitle = `Chronological list (${order}) — ${batch.length} in this import.`
  } else if (viewMode === 'cluster') {
    subtitle = `Grouped by merchant cluster — ${batch.length} in this import.`
  } else {
    subtitle = `Category (where assigned) → cluster — ${batch.length} in this import.`
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            Review imported transactions
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/import')}
          className="shrink-0 self-start rounded-full border border-[var(--color-border)] bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.08]"
        >
          Back to Import
        </button>
      </header>

      <fieldset className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-white/[0.02] p-4">
        <legend className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          View
        </legend>
        <div className="flex flex-wrap gap-2">
          <ToggleButton
            pressed={viewMode === 'date'}
            onClick={() => setViewMode('date')}
          >
            By date
          </ToggleButton>
          <ToggleButton
            pressed={viewMode === 'cluster'}
            onClick={() => setViewMode('cluster')}
          >
            By cluster
          </ToggleButton>
          <ToggleButton
            pressed={viewMode === 'category'}
            onClick={() => setViewMode('category')}
          >
            By category
          </ToggleButton>
        </div>
        {viewMode === 'date' && (
          <fieldset className="mt-0 flex min-w-0 flex-col gap-2 border-0 border-t border-[var(--color-border)] pt-3">
            <legend className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Date order
            </legend>
            <div className="flex flex-wrap gap-2">
              <ToggleButton
                pressed={dateOrder === 'asc'}
                onClick={() => setDateOrder('asc')}
              >
                Oldest first
              </ToggleButton>
              <ToggleButton
                pressed={dateOrder === 'desc'}
                onClick={() => setDateOrder('desc')}
              >
                Newest first
              </ToggleButton>
            </div>
          </fieldset>
        )}
      </fieldset>

      {viewMode === 'date' && (
        <ul className="space-y-1 rounded-xl border border-[var(--color-border)] bg-white/[0.03] p-4">
          {sortedByDate.map((t) => (
            <TransactionRow key={t.id} t={t} showCategory />
          ))}
        </ul>
      )}

      {viewMode === 'cluster' && (
        <div className="space-y-3">
          {clusterEntries.map(([clusterId, rows]) => {
            const sample =
              rows[0]?.cleaned_merchant || rows[0]?.raw_merchant || '—'
            return (
              <details
                key={clusterId}
                open
                className="group rounded-xl border border-[var(--color-border)] bg-white/[0.03]"
              >
                <summary className="cursor-pointer list-none px-4 py-3 font-medium text-zinc-100 marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-mono text-xs text-zinc-500">
                      {shortClusterLabel(clusterId)}
                    </span>
                    <span className="text-zinc-300">{sample}</span>
                    <span className="ml-auto tabular-nums text-sm font-normal text-zinc-500">
                      {rows.length}{' '}
                      {rows.length === 1 ? 'transaction' : 'transactions'}
                    </span>
                  </span>
                </summary>
                <ul className="space-y-1 border-t border-[var(--color-border)] px-4 py-3">
                  {rows.map((t) => (
                    <TransactionRow key={t.id} t={t} showCategory />
                  ))}
                </ul>
              </details>
            )
          })}
        </div>
      )}

      {viewMode === 'category' && (
        <div className="space-y-3">
          {categories.map((category) => {
            const clusters = hierarchy.get(category)
            if (!clusters) return null
            const catClusterEntries = [...clusters.entries()].sort((a, b) => {
              const ma = a[1][0]?.cleaned_merchant ?? ''
              const mb = b[1][0]?.cleaned_merchant ?? ''
              return ma.localeCompare(mb) || a[0].localeCompare(b[0])
            })
            const catCount = [...clusters.values()].reduce(
              (n, arr) => n + arr.length,
              0,
            )

            return (
              <details
                key={category}
                open
                className="group rounded-xl border border-[var(--color-border)] bg-white/[0.03]"
              >
                <summary className="cursor-pointer list-none px-4 py-3 font-medium text-zinc-100 marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="flex items-baseline justify-between gap-3">
                    <span>{category}</span>
                    <span className="text-sm font-normal tabular-nums text-zinc-500">
                      {catCount}{' '}
                      {catCount === 1 ? 'transaction' : 'transactions'}
                    </span>
                  </span>
                </summary>
                <div className="space-y-2 border-t border-[var(--color-border)] px-3 pb-3 pt-2">
                  {catClusterEntries.map(([clusterId, rows]) => {
                    const sample =
                      rows[0]?.cleaned_merchant ||
                      rows[0]?.raw_merchant ||
                      '—'
                    return (
                      <details
                        key={clusterId}
                        open
                        className="rounded-lg bg-white/[0.04]"
                      >
                        <summary className="cursor-pointer list-none px-3 py-2 text-sm text-zinc-200 marker:content-none [&::-webkit-details-marker]:hidden">
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="font-mono text-xs text-zinc-500">
                              {shortClusterLabel(clusterId)}
                            </span>
                            <span className="text-zinc-300">{sample}</span>
                            <span className="ml-auto tabular-nums text-zinc-500">
                              {rows.length}×
                            </span>
                          </span>
                        </summary>
                        <ul className="space-y-1 border-t border-white/[0.06] px-3 py-2">
                          {rows.map((t) => (
                            <TransactionRow
                              key={t.id}
                              t={t}
                              showCategory={false}
                            />
                          ))}
                        </ul>
                      </details>
                    )
                  })}
                </div>
              </details>
            )
          })}
        </div>
      )}
    </div>
  )
}
