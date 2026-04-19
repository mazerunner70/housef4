import { Link, useLocation, useNavigate } from 'react-router-dom'

import { Spinner } from '@/components/ui/Spinner'
import { useTransactions } from '@/hooks/useTransactions'
import {
  clearLastImportTransactionIds,
  readLastImportTransactionIds,
} from '@/lib/lastImportTransactionIds'
import type { ImportParseResult, Transaction } from '@/lib/types'
import { useAppStore } from '@/store/appStore'

type ReviewLocationState = {
  transactionIds?: string[]
  importSummary?: ImportParseResult
}

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

export function ImportTransactionsReviewPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as ReviewLocationState | null
  const lastImportSummary = useAppStore((s) => s.lastImportSummary)

  const fromStateIds = state?.transactionIds
  const fromStateSummary = state?.importSummary?.transactionIds
  const fromStore = lastImportSummary?.transactionIds
  const fromSession = readLastImportTransactionIds()

  let transactionIds: string[] = []
  if (fromStateIds?.length) {
    transactionIds = fromStateIds
  } else if (fromStateSummary?.length) {
    transactionIds = fromStateSummary
  } else if (fromSession.length) {
    transactionIds = fromSession
  } else if (fromStore?.length) {
    transactionIds = fromStore
  }

  const query = useTransactions()

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

  const allTxs = query.data.transactions
  const lastRowCount = lastImportSummary?.rowCount
  let idFallbackBanner: string | null = null

  let batch: Transaction[] = []
  if (transactionIds.length === 0) {
    if (
      lastRowCount &&
      lastRowCount > 0 &&
      lastRowCount === allTxs.length &&
      allTxs.length > 0
    ) {
      batch = allTxs
      idFallbackBanner =
        'No transaction ids for this import; showing all loaded rows (count matches last import).'
    }
  } else {
    const idSet = new Set(transactionIds)
    batch = allTxs.filter((t) => idSet.has(t.id))
    if (batch.length === 0 && allTxs.length > 0) {
      clearLastImportTransactionIds()
      if (
        lastRowCount &&
        lastRowCount > 0 &&
        lastRowCount === allTxs.length
      ) {
        batch = allTxs
        idFallbackBanner =
          'Saved import ids did not match any loaded transaction (stale list was cleared). Showing all loaded rows because the count matches your last import.'
      }
    }
  }

  if (batch.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-zinc-100">
          Import transaction review
        </h1>
        <p className="max-w-xl text-zinc-400">
          {transactionIds.length === 0
            ? 'No import batch is selected, or the last import did not include transaction ids and your loaded rows do not match its row count. Import again from the Import page, then open this view from the Transactions card.'
            : 'None of the saved import ids matched loaded transactions, and the row count did not match your account total. Try importing again, or return to Import.'}
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

  const missing =
    transactionIds.length > 0
      ? transactionIds.length - batch.length
      : 0

  const hierarchy = groupByCategoryThenCluster(batch)
  const categories = [...hierarchy.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  )

  return (
    <div className="space-y-6">
      {idFallbackBanner && (
        <p
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
          role="status"
        >
          {idFallbackBanner}
        </p>
      )}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            Review imported transactions
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Category → cluster → rows from this file ({batch.length} loaded
            {missing > 0 ? `, ${missing} id(s) not yet listed` : ''}).
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/import')}
          className="shrink-0 self-start rounded-full border border-[var(--color-border)] bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.08]"
        >
          Back to Import
        </button>
      </header>

      <div className="space-y-3">
        {categories.map((category) => {
          const clusters = hierarchy.get(category)
          if (!clusters) return null
          const clusterEntries = [...clusters.entries()].sort((a, b) => {
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
                    {catCount} {catCount === 1 ? 'transaction' : 'transactions'}
                  </span>
                </span>
              </summary>
              <div className="space-y-2 border-t border-[var(--color-border)] px-3 pb-3 pt-2">
                {clusterEntries.map(([clusterId, rows]) => {
                  const sample =
                    rows[0]?.cleaned_merchant || rows[0]?.raw_merchant || '—'
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
                          <li
                            key={t.id}
                            className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                          >
                            <span className="min-w-0 text-zinc-400">
                              <time
                                dateTime={new Date(t.date).toISOString()}
                                className="tabular-nums text-zinc-500"
                              >
                                {new Date(t.date).toLocaleDateString()}
                              </time>
                              <span className="mx-2 text-zinc-600">·</span>
                              <span className="text-zinc-200">
                                {t.raw_merchant}
                              </span>
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
    </div>
  )
}
