import type { ImportParseResult } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

type ImportSummaryCardProps = {
  readonly summary: ImportParseResult
  readonly onContinueDashboard: () => void
  readonly onReviewUnknown: () => void
  readonly onReviewTransactions: () => void
}

export function ImportSummaryCard({
  summary,
  onContinueDashboard,
  onReviewUnknown,
  onReviewTransactions,
}: ImportSummaryCardProps) {
  return (
    <Card
      title="Import complete"
      description="We parsed your file and matched merchants to categories where confidence was high."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="rounded-xl bg-white/[0.04] p-4">
          <p className="text-sm text-zinc-500">Transactions</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
            {summary.rowCount}
          </p>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-4">
          <p className="text-sm text-zinc-500">Known merchants</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-400">
            {summary.knownMerchants}
          </p>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-4">
          <p className="text-sm text-zinc-500">Needs review</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-400">
            {summary.unknownMerchants}
          </p>
        </div>
        {(summary.existingTransactionsUpdated ?? 0) > 0 && (
          <div className="rounded-xl bg-white/[0.04] p-4">
            <p className="text-sm text-zinc-500">History re-clustered</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-sky-400">
              {summary.existingTransactionsUpdated}
            </p>
          </div>
        )}
        {(summary.newClustersTouched ?? 0) > 0 && (
          <div className="rounded-xl bg-white/[0.04] p-4">
            <p className="text-sm text-zinc-500">New clusters (this file)</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-200">
              {summary.newClustersTouched}
            </p>
          </div>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={onReviewTransactions}
          disabled={summary.rowCount === 0}
        >
          Review imported transactions
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onContinueDashboard}
        >
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
