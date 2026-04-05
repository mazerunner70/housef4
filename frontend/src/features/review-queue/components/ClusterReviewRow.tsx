import { useId, useState } from 'react'

import type { PendingCluster } from '@/lib/types'
import { Card } from '@/components/ui/Card'
import { CategorySelectDropdown } from '@/features/review-queue/components/CategorySelectDropdown'
import { ConfirmClusterTagButton } from '@/features/review-queue/components/ConfirmClusterTagButton'

type ClusterReviewRowProps = {
  cluster: PendingCluster
  onConfirm: (clusterId: string, category: string) => void
  isSubmitting?: boolean
}

export function ClusterReviewRow({
  cluster,
  onConfirm,
  isSubmitting,
}: ClusterReviewRowProps) {
  const baseId = useId()
  const suggested = cluster.suggested_category ?? ''
  const [category, setCategory] = useState(suggested)

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Sample merchants
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {cluster.sample_merchants.map((m) => (
                <li
                  key={m}
                  className="rounded-lg bg-white/[0.06] px-2.5 py-1 font-mono text-xs text-zinc-200"
                >
                  {m}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-zinc-500">Occurrences</span>{' '}
              <span className="font-semibold tabular-nums text-zinc-100">
                {cluster.total_transactions}
              </span>
            </div>
            <div>
              <span className="text-zinc-500">Total amount</span>{' '}
              <span className="font-semibold tabular-nums text-zinc-100">
                {cluster.total_amount.toLocaleString(undefined, {
                  style: 'currency',
                  currency: 'USD',
                })}
              </span>
            </div>
          </div>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end lg:w-auto">
          <CategorySelectDropdown
            id={`${baseId}-category`}
            value={category}
            onChange={setCategory}
            disabled={isSubmitting}
          />
          <ConfirmClusterTagButton
            loading={isSubmitting}
            disabled={!category || isSubmitting}
            onClick={() => onConfirm(cluster.cluster_id, category)}
          />
        </div>
      </div>
    </Card>
  )
}
