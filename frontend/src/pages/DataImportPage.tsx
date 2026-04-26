import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/Button'
import { ImportDropzone } from '@/features/import/components/ImportDropzone'
import { ImportSummaryCard } from '@/features/import/components/ImportSummaryCard'
import { UploadProgressIndicator } from '@/features/import/components/UploadProgressIndicator'
import { postImport } from '@/api/client'
import { useTransactionFiles } from '@/hooks/useTransactionFiles'
import { syncLastImportTransactionIds } from '@/lib/lastImportTransactionIds'
import type { ImportParseResult } from '@/lib/types'
import { useAppStore } from '@/store/appStore'

type Phase = 'idle' | 'parsing' | 'done'

export function DataImportPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setHasUploadedData = useAppStore((s) => s.setHasUploadedData)
  const setLastImportSummary = useAppStore((s) => s.setLastImportSummary)
  const [phase, setPhase] = useState<Phase>('idle')
  const [summary, setSummary] = useState<ImportParseResult | null>(null)
  const [fileLabel, setFileLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileHistory = useTransactionFiles()

  const handleFile = async (file: File) => {
    setError(null)
    setPhase('parsing')
    setFileLabel(file.name)
    try {
      const result = await postImport(file)
      setSummary(result)
      setLastImportSummary(result)
      syncLastImportTransactionIds(result.transactionIds)
      setHasUploadedData(true)
      void queryClient.invalidateQueries({ queryKey: ['metrics'] })
      void queryClient.invalidateQueries({ queryKey: ['transactions'] })
      void queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      void queryClient.invalidateQueries({ queryKey: ['transaction-files'] })
      setPhase('done')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Import failed'
      setError(message)
      setPhase('idle')
    }
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
            Import transactions
          </h1>
          <p className="mt-2 max-w-2xl text-zinc-400">
            Upload a bank export (CSV, OFX, QFX, or QIF). The server parses the
            file via <code className="text-zinc-300">POST /api/imports</code>{' '}
            and returns a summary of ingested rows.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="shrink-0 self-start"
          onClick={() => navigate('/import/review-transactions')}
        >
          Review last import
        </Button>
      </header>

      {error && phase === 'idle' && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {phase === 'idle' && (
        <ImportDropzone onFileSelected={(f) => void handleFile(f)} />
      )}

      {phase === 'parsing' && (
        <UploadProgressIndicator
          message="Parsing transactions…"
          detail={
            fileLabel
              ? `Reading ${fileLabel} and normalizing merchant text.`
              : undefined
          }
        />
      )}

      {phase === 'done' && summary && (
        <ImportSummaryCard
          summary={summary}
          onContinueDashboard={() => navigate('/dashboard')}
          onReviewUnknown={() => navigate('/review-queue')}
          onReviewTransactions={() =>
            navigate('/import/review-transactions', {
              state: { importSummary: summary },
            })
          }
        />
      )}

      <section
        className="rounded-xl border border-[var(--color-border)] bg-white/[0.02] p-4"
        aria-label="Import history"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Import history
        </h2>
        {fileHistory.isPending && (
          <p className="mt-3 text-sm text-zinc-500">Loading import history…</p>
        )}
        {fileHistory.isError && (
          <p className="mt-3 text-sm text-amber-200/90">
            Could not load import history.
          </p>
        )}
        {fileHistory.isSuccess && fileHistory.data.transaction_files.length === 0 && (
          <p className="mt-3 text-sm text-zinc-500">
            No files recorded yet. After a successful upload, the file name and
            time appear here.
          </p>
        )}
        {fileHistory.isSuccess && fileHistory.data.transaction_files.length > 0 && (
          <ul className="mt-3 divide-y divide-white/[0.06]">
            {fileHistory.data.transaction_files.map((f) => (
              <li
                key={f.id}
                className="flex flex-col gap-1 py-3 first:pt-0 sm:flex-row sm:items-baseline sm:justify-between"
              >
                <span className="min-w-0 font-medium text-zinc-200">
                  {f.source.name}
                </span>
                <span className="shrink-0 text-sm text-zinc-500">
                  <time
                    dateTime={new Date(f.timing.completed_at).toISOString()}
                  >
                    {new Date(f.timing.completed_at).toLocaleString()}
                  </time>
                  <span className="ml-2 tabular-nums text-zinc-600">
                    · {f.result.rowCount}{' '}
                    {f.result.rowCount === 1 ? 'row' : 'rows'}
                  </span>
                  {f.format.source_format && (
                    <span className="ml-1 uppercase">
                      · {f.format.source_format}
                    </span>
                  )}
                  <span className="ml-2 tabular-nums text-zinc-600">
                    · {f.source.size_bytes.toLocaleString()} bytes
                  </span>
                </span>
                <p className="mt-1 w-full text-xs text-zinc-500">
                  {f.result.knownMerchants} known merchants,{' '}
                  {f.result.unknownMerchants} unknown
                  {f.result.existingTransactionsUpdated > 0 && (
                    <>
                      {' '}
                      · {f.result.existingTransactionsUpdated} existing updated
                    </>
                  )}
                  {f.source.content_type && (
                    <span> · {f.source.content_type}</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
