import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import {
  buildTransferPairs,
  enrichTransactionsWithAccount,
  groupTransferPairs,
  sortedTransferGroupEntries,
  type TransferGroupBy,
  type TransferPair,
} from '@/features/review-queue/lib/transferPairs'
import { useAccounts } from '@/hooks/useAccounts'
import { useTransactionFiles } from '@/hooks/useTransactionFiles'
import { useTransactions } from '@/hooks/useTransactions'
import { cn } from '@/lib/cn'
import { formatCurrencyAmount, resolveCurrencyCode } from '@/lib/formatCurrency'

type TransferPairsReviewProps = Readonly<{
  defaultCurrency: string
}>

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

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function confidenceBadgeClass(confidence: string | undefined): string {
  if (confidence === 'exact') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  }
  if (confidence === 'within_epsilon') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  }
  return 'border-white/10 bg-white/[0.06] text-zinc-400'
}

function TransferPairRow({
  pair,
  defaultCurrency,
  groupBy,
}: Readonly<{
  pair: TransferPair
  defaultCurrency: string
  groupBy: TransferGroupBy
}>) {
  const counterparty =
    groupBy === 'source' ? pair.destination : pair.source
  const amountLabel = formatCurrencyAmount(
    pair.amount,
    resolveCurrencyCode(pair.source.currency, defaultCurrency),
  )

  return (
    <li className="rounded-xl border border-[var(--color-border)] bg-white/[0.03] px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-zinc-100">
            {pair.source.account_name}
            <span className="mx-2 font-normal text-zinc-500">→</span>
            {pair.destination.account_name}
          </p>
          <p className="text-xs text-zinc-500">
            {groupBy === 'source' ? 'To' : 'From'}{' '}
            <span className="text-zinc-300">{counterparty.account_name}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-semibold tabular-nums text-zinc-100">
            {amountLabel}
          </span>
          {(pair.pairing_confidence || pair.pairing_source) && (
            <span className="flex flex-wrap justify-end gap-1.5">
              {pair.pairing_confidence && (
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    confidenceBadgeClass(pair.pairing_confidence),
                  )}
                >
                  {pair.pairing_confidence.replaceAll('_', ' ')}
                </span>
              )}
              {pair.pairing_source && (
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                  {pair.pairing_source}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-medium uppercase tracking-wide text-zinc-500">
            Outflow (source)
          </dt>
          <dd className="mt-0.5 text-zinc-300">
            <time dateTime={new Date(pair.source.date).toISOString()}>
              {formatDate(pair.source.date)}
            </time>
            <span className="mx-1.5 text-zinc-600">·</span>
            <span className="text-zinc-200">{pair.source.raw_merchant}</span>
            <span className="mt-0.5 block tabular-nums text-zinc-400">
              {formatCurrencyAmount(pair.source.amount, pair.source.currency)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="font-medium uppercase tracking-wide text-zinc-500">
            Inflow (destination)
          </dt>
          <dd className="mt-0.5 text-zinc-300">
            <time dateTime={new Date(pair.destination.date).toISOString()}>
              {formatDate(pair.destination.date)}
            </time>
            <span className="mx-1.5 text-zinc-600">·</span>
            <span className="text-zinc-200">{pair.destination.raw_merchant}</span>
            <span className="mt-0.5 block tabular-nums text-emerald-400/90">
              {formatCurrencyAmount(
                pair.destination.amount,
                pair.destination.currency,
              )}
            </span>
          </dd>
        </div>
      </dl>
    </li>
  )
}

export function TransferPairsReview({ defaultCurrency }: TransferPairsReviewProps) {
  const [reviewOpen, setReviewOpen] = useState(false)
  const [groupBy, setGroupBy] = useState<TransferGroupBy>('source')

  const transactionsQuery = useTransactions()
  const accountsQuery = useAccounts()
  const filesQuery = useTransactionFiles()

  const isLoading =
    reviewOpen &&
    (transactionsQuery.isPending ||
      accountsQuery.isPending ||
      filesQuery.isPending)

  const isError =
    reviewOpen &&
    (transactionsQuery.isError ||
      accountsQuery.isError ||
      filesQuery.isError)

  const { pairs, incomplete, groupEntries } = useMemo(() => {
    if (
      !reviewOpen ||
      !transactionsQuery.data ||
      !accountsQuery.data ||
      !filesQuery.data
    ) {
      return { pairs: [], incomplete: [], groupEntries: [] }
    }

    const enriched = enrichTransactionsWithAccount(
      transactionsQuery.data.transactions,
      filesQuery.data.transaction_files,
      accountsQuery.data.accounts,
    )
    const built = buildTransferPairs(enriched)
    const groups = groupTransferPairs(built.pairs, groupBy)
    const entries = sortedTransferGroupEntries(
      groups,
      accountsQuery.data.accounts,
      groupBy,
    )
    return {
      pairs: built.pairs,
      incomplete: built.incomplete,
      groupEntries: entries,
    }
  }, [
    reviewOpen,
    transactionsQuery.data,
    accountsQuery.data,
    filesQuery.data,
    groupBy,
  ])

  if (!reviewOpen) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.03] px-6 py-12 text-center">
        <p className="mx-auto max-w-lg text-sm text-zinc-400">
          Inspect internal transfers detected between your accounts. Source is
          always the outflow leg (canonical negative amount); destination is the
          matching inflow.
        </p>
        <Button
          type="button"
          variant="secondary"
          className="mt-6"
          onClick={() => setReviewOpen(true)}
        >
          Account transfers review
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <fieldset className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-white/[0.02] p-4">
        <legend className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Group by
        </legend>
        <div className="flex flex-wrap gap-2">
          <ToggleButton
            pressed={groupBy === 'source'}
            onClick={() => setGroupBy('source')}
          >
            Source account
          </ToggleButton>
          <ToggleButton
            pressed={groupBy === 'destination'}
            onClick={() => setGroupBy('destination')}
          >
            Destination account
          </ToggleButton>
        </div>
        <p className="text-xs text-zinc-500">
          {groupBy === 'source'
            ? 'Grouped by the account money left (negative amount).'
            : 'Grouped by the account money arrived at (positive amount).'}
        </p>
      </fieldset>

      {isLoading && (
        <div className="flex min-h-[24vh] flex-col items-center justify-center gap-4">
          <Spinner label="Loading transfer pairings" />
          <p className="text-sm text-zinc-500">Loading transfer pairings…</p>
        </div>
      )}

      {isError && (
        <p className="text-sm text-rose-400" role="alert">
          Could not load transfer pairings. Try again.
        </p>
      )}

      {!isLoading && !isError && pairs.length === 0 && (
        <p className="rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.03] px-6 py-12 text-center text-zinc-500">
          No paired internal transfers found yet. Pairings appear after imports
          when matching legs are detected across accounts.
        </p>
      )}

      {!isLoading && !isError && pairs.length > 0 && (
        <div className="space-y-8">
          <p className="text-sm font-medium text-zinc-200">
            {pairs.length} paired transfer{pairs.length === 1 ? '' : 's'}
          </p>
          {groupEntries.map(({ accountId, accountName, pairs: groupPairs }) => (
            <section key={accountId || accountName}>
              <h3 className="mb-3 text-sm font-semibold text-zinc-100">
                {accountName}
                <span className="ml-2 font-normal tabular-nums text-zinc-500">
                  ({groupPairs.length})
                </span>
              </h3>
              <ul className="space-y-3">
                {groupPairs.map((pair) => (
                  <TransferPairRow
                    key={pair.pairing_id}
                    pair={pair}
                    defaultCurrency={defaultCurrency}
                    groupBy={groupBy}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {!isLoading && !isError && incomplete.length > 0 && (
        <details className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-amber-200">
            {incomplete.length} incomplete pairing
            {incomplete.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-3 space-y-2 text-sm text-zinc-400">
            {incomplete.map((t) => (
              <li key={t.id}>
                <span className="text-zinc-200">{t.raw_merchant}</span>
                <span className="mx-1.5 text-zinc-600">·</span>
                {t.account_name}
                <span className="mx-1.5 text-zinc-600">·</span>
                <span className="tabular-nums">
                  {formatCurrencyAmount(t.amount, t.currency)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
