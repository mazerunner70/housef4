import { useState } from 'react'

import { AmbiguousClusterList } from '@/features/review-queue/components/AmbiguousClusterList'
import { QueueStatusHeader } from '@/features/review-queue/components/QueueStatusHeader'
import { Spinner } from '@/components/ui/Spinner'
import { useReviewQueue } from '@/hooks/useReviewQueue'
import { useTagCluster } from '@/hooks/useTagCluster'

export function ReviewQueuePage() {
  const { data, isPending, isError, error } = useReviewQueue()
  const tagCluster = useTagCluster()
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
    <div>
      <QueueStatusHeader pendingCount={clusters.length} />
      <AmbiguousClusterList
        clusters={clusters}
        defaultCurrency={data.default_currency}
        onConfirm={onConfirm}
        submittingId={submittingId}
      />
      {tagCluster.isError && (
        <p className="mt-6 text-sm text-rose-600 dark:text-rose-400" role="alert">
          Could not save category. Try again.
        </p>
      )}
    </div>
  )
}
