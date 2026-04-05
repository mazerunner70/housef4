import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

import { ImportDropzone } from '@/features/import/components/ImportDropzone'
import { ImportSummaryCard } from '@/features/import/components/ImportSummaryCard'
import { UploadProgressIndicator } from '@/features/import/components/UploadProgressIndicator'
import { postImport } from '@/api/client'
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

  const handleFile = async (file: File) => {
    setError(null)
    setPhase('parsing')
    setFileLabel(file.name)
    try {
      const result = await postImport(file)
      setSummary(result)
      setLastImportSummary(result)
      setHasUploadedData(true)
      void queryClient.invalidateQueries({ queryKey: ['metrics'] })
      void queryClient.invalidateQueries({ queryKey: ['transactions'] })
      void queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      setPhase('done')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Import failed'
      setError(message)
      setPhase('idle')
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
          Import transactions
        </h1>
        <p className="mt-2 max-w-2xl text-zinc-400">
          Upload a bank export (CSV, OFX, QFX, or QIF). The server parses the
          file via <code className="text-zinc-300">POST /api/imports</code> and
          returns a summary of ingested rows.
        </p>
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
        />
      )}
    </div>
  )
}
