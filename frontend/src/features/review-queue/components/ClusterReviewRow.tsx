import { useId, useState } from 'react'

import type { PendingCluster } from '@/lib/types'
import { formatCurrencyAmount, resolveCurrencyCode } from '@/lib/formatCurrency'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { Card } from '@/components/ui/Card'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { TAXONOMY_CATEGORIES } from '@/lib/taxonomy'
import { ClusterMatchingTransactionsDialog } from '@/features/review-queue/components/ClusterMatchingTransactionsDialog'
import { ConfirmClusterTagButton } from '@/features/review-queue/components/ConfirmClusterTagButton'

type ClusterReviewRowProps = Readonly<{
  cluster: PendingCluster
  /** Profile default (ISO 4217) from `GET /api/review-queue` when the cluster has no file currency. */
  defaultCurrency: string
  onConfirm: (clusterId: string, category: string) => void
  isSubmitting?: boolean
}>

export function ClusterReviewRow({
  cluster,
  defaultCurrency,
  onConfirm,
  isSubmitting,
}: ClusterReviewRowProps) {
  const baseId = useId()
  const suggested = cluster.suggested_category ?? ''
  const [category, setCategory] = useState(suggested)
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)
  const [matchingTxOpen, setMatchingTxOpen] = useState(false)

  const totalFormatted = formatCurrencyAmount(
    cluster.total_amount,
    resolveCurrencyCode(cluster.currency, defaultCurrency),
  )

  return (
    <Card
      className={cn(
        'p-5',
        categoryMenuOpen && 'relative z-50',
      )}
    >
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="flex-1 space-y-3">
          <div className="flex min-w-0 flex-row flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Sample merchants
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {cluster.sample_merchants.map((m) => (
                  <li
                    key={m}
                    className="w-max max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-lg bg-white/[0.06] px-2.5 py-1 font-mono text-xs text-zinc-200"
                  >
                    {m}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
              <div className="whitespace-nowrap">
                <span className="text-zinc-500">Occurrences</span>{' '}
                <span className="font-semibold tabular-nums text-zinc-100">
                  {cluster.total_transactions}
                </span>
              </div>
              <div className="whitespace-nowrap">
                <span className="text-zinc-500">Total amount</span>{' '}
                <span className="font-semibold tabular-nums text-zinc-100">
                  {totalFormatted}
                </span>
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="mt-1 w-full sm:w-auto"
            onClick={() => setMatchingTxOpen(true)}
          >
            View matching transactions
          </Button>
        </div>
        <div className="flex min-w-0 w-full flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end lg:max-w-full">
          <SearchableSelect
            id={`${baseId}-category`}
            options={TAXONOMY_CATEGORIES}
            value={category}
            onChange={setCategory}
            placeholder="Choose category"
            searchPlaceholder="Search categories…"
            searchLabel="Filter categories"
            onOpenChange={setCategoryMenuOpen}
            disabled={isSubmitting}
          />
          <ConfirmClusterTagButton
            loading={isSubmitting}
            disabled={!category || isSubmitting}
            onClick={() => onConfirm(cluster.cluster_id, category)}
          />
        </div>
      </div>
      {matchingTxOpen ? (
        <ClusterMatchingTransactionsDialog
          clusterId={cluster.cluster_id}
          onClose={() => setMatchingTxOpen(false)}
        />
      ) : null}
    </Card>
  )
}
