import type { ImportParseResult } from '@/lib/types'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ImportCurrencyEditor } from '@/features/import/components/ImportCurrencyEditor'

type ImportSummaryCardProps = {
  readonly summary: ImportParseResult
  readonly onContinueDashboard: () => void
  readonly onReviewUnknown: () => void
  readonly onReviewTransactions: () => void
  readonly onCurrencyApplied?: (currency: string) => void
}

export function ImportSummaryCard({
  summary,
  onContinueDashboard,
  onReviewUnknown,
  onReviewTransactions,
  onCurrencyApplied,
}: ImportSummaryCardProps) {
  const neg = summary.amountNegation
  let normalizationSubtext: ReactNode = null
  if (neg?.applied) {
    if (neg.explicitOverride) {
      normalizationSubtext = (
        <span className="block pt-1 text-xs">
          Controlled by the <code className="text-zinc-300">negate_amounts</code> upload field.
        </span>
      )
    } else if (neg.suggestInterest || neg.suggestPriorImport) {
      normalizationSubtext = (
        <span className="block pt-1 text-xs">
          Decided automatically from this file (for example interest-line cues) and/or your last
          import for this account.
        </span>
      )
    }
  }

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
      <ImportCurrencyEditor
        importFileId={summary.importFileId}
        initialCurrency={summary.currency}
        onApplied={onCurrencyApplied}
      />
      {neg && (
        <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
          {neg.applied ? (
            <>
              <span className="text-zinc-200">Amount values negated</span>{' '}
              (canonical: negatives are money leaving this account, positives money arriving).
              {normalizationSubtext}
            </>
          ) : (
            <>
              <span className="text-zinc-200">Amount values not negated</span> — stored as parsed from
              the file.
              {(neg.suggestInterest || neg.suggestPriorImport) && (
                <span className="block pt-1 text-xs text-amber-400/90">
                  Heuristics suggested flipping signs; pass{' '}
                  <code className="text-zinc-300">negate_amounts=true</code> on upload if totals look
                  inverted.
                </span>
              )}
            </>
          )}
        </p>
      )}
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
