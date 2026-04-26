import type { PendingCluster } from '@/lib/types'
import { ClusterReviewRow } from '@/features/review-queue/components/ClusterReviewRow'

type AmbiguousClusterListProps = {
  clusters: PendingCluster[]
  defaultCurrency: string
  onConfirm: (clusterId: string, category: string) => void
  submittingId?: string | null
}

export function AmbiguousClusterList({
  clusters,
  defaultCurrency,
  onConfirm,
  submittingId,
}: AmbiguousClusterListProps) {
  if (clusters.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.03] px-6 py-12 text-center text-zinc-500">
        You’re caught up. New ambiguous clusters will appear here after imports.
      </p>
    )
  }

  return (
    <ul className="space-y-4">
      {clusters.map((cluster) => (
        <li key={cluster.cluster_id}>
          <ClusterReviewRow
            cluster={cluster}
            defaultCurrency={defaultCurrency}
            onConfirm={onConfirm}
            isSubmitting={submittingId === cluster.cluster_id}
          />
        </li>
      ))}
    </ul>
  )
}
