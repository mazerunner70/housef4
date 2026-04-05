import type { ImportParseResult } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

type ImportSummaryCardProps = {
  summary: ImportParseResult
  onContinueDashboard: () => void
  onReviewUnknown: () => void
}

export function ImportSummaryCard({
  summary,
  onContinueDashboard,
  onReviewUnknown,
}: ImportSummaryCardProps) {
  return (
    <Card
      title="Import complete"
      description="We parsed your file and matched merchants to categories where confidence was high."
    >
      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-white/[0.04] p-4">
          <dt className="text-sm text-zinc-500">Transactions</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
            {summary.rowCount}
          </dd>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-4">
          <dt className="text-sm text-zinc-500">Known merchants</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-emerald-400">
            {summary.knownMerchants}
          </dd>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-4">
          <dt className="text-sm text-zinc-500">Needs review</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-amber-400">
            {summary.unknownMerchants}
          </dd>
        </div>
      </dl>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" onClick={onContinueDashboard}>
          View dashboard
        </Button>
        {summary.unknownMerchants > 0 && (
          <Button
            type="button"
            variant="secondary"
            onClick={onReviewUnknown}
          >
            Review unknown clusters
          </Button>
        )}
      </div>
    </Card>
  )
}
