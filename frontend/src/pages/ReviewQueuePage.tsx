import { useMemo, useState } from 'react'

import { AmbiguousClusterList } from '@/features/review-queue/components/AmbiguousClusterList'
import { QueueStatusHeader } from '@/features/review-queue/components/QueueStatusHeader'
import {
  ReviewModeToggle,
  type ReviewMode,
} from '@/features/review-queue/components/ReviewModeToggle'
import { TransferPairsReview } from '@/features/review-queue/components/TransferPairsReview'
import { Spinner } from '@/components/ui/Spinner'
import { useReviewQueue } from '@/hooks/useReviewQueue'
import { useTagCluster } from '@/hooks/useTagCluster'
import { useTransactionFiles } from '@/hooks/useTransactionFiles'
import { useTransactions } from '@/hooks/useTransactions'
import { resolveCurrencyCode } from '@/lib/formatCurrency'

export function ReviewQueuePage() {
  const { data, isPending, isError, error } = useReviewQueue()
  const transactionsQuery = useTransactions()
  const filesQuery = useTransactionFiles()
  const tagCluster = useTagCluster()
  const [reviewMode, setReviewMode] = useState<ReviewMode>('categories')
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  const onConfirm = (clusterId: string, category: string) => {
    setSubmittingId(clusterId)
    tagCluster.mutate(
      { cluster_id: clusterId, assigned_category: category },
      {
        onSettled: () => setSubmittingId(null),
      },
    )
  }

  const currencyByClusterId = useMemo(() => {
    const fileCurrency = new Map(
      (filesQuery.data?.transaction_files ?? []).map(
        (f) => [f.id, f.format.currency] as const,
      ),
    )
    const m = new Map<string, string>()
    for (const t of transactionsQuery.data?.transactions ?? []) {
      const cid = t.cluster_id
      if (!cid || m.has(cid)) continue
      m.set(
        cid,
        resolveCurrencyCode(t.currency, fileCurrency.get(t.transaction_file_id)),
      )
    }
    return m
  }, [transactionsQuery.data?.transactions, filesQuery.data?.transaction_files])

  if (isPending) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <Spinner />
        <p className="text-sm text-zinc-500">Loading review queue…</p>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <p className="text-zinc-400">
        {error instanceof Error ? error.message : 'Could not load review queue.'}
      </p>
    )
  }

  const clusters = data.pending_clusters

  return (
    <div className="space-y-6">
      <QueueStatusHeader mode={reviewMode} pendingCount={clusters.length} />
      <ReviewModeToggle mode={reviewMode} onChange={setReviewMode} />

      {reviewMode === 'categories' && (
        <>
          <AmbiguousClusterList
            clusters={clusters}
            defaultCurrency={data.default_currency}
            currencyByClusterId={currencyByClusterId}
            onConfirm={onConfirm}
            submittingId={submittingId}
          />
          {tagCluster.isError && (
            <p
              className="mt-6 text-sm text-rose-600 dark:text-rose-400"
              role="alert"
            >
              Could not save category. Try again.
            </p>
          )}
        </>
      )}

      {reviewMode === 'transfers' && (
        <TransferPairsReview defaultCurrency={data.default_currency} />
      )}
    </div>
  )
}
