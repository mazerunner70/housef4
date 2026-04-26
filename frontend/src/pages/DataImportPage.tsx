import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/Button'
import { ImportDropzone } from '@/features/import/components/ImportDropzone'
import { ImportSummaryCard } from '@/features/import/components/ImportSummaryCard'
import { UploadProgressIndicator } from '@/features/import/components/UploadProgressIndicator'
import { postImport, type PostImportAccount } from '@/api/client'
import { useAccounts } from '@/hooks/useAccounts'
import { useTransactionFiles } from '@/hooks/useTransactionFiles'
import type { ImportParseResult } from '@/lib/types'
import { useAppStore } from '@/store/appStore'

const NEW_ACCOUNT = '__new__'

type Phase = 'idle' | 'parsing' | 'done'

function importSatisfied(
  accountLoadError: boolean,
  choice: string,
  newName: string,
): boolean {
  const t = newName.trim()
  if (accountLoadError) return t.length > 0
  if (choice === NEW_ACCOUNT) return t.length > 0
  return choice.length > 0
}

function importAccountParam(
  accountLoadError: boolean,
  choice: string,
  newName: string,
): PostImportAccount {
  if (accountLoadError || choice === NEW_ACCOUNT) {
    return { newAccountName: newName.trim() }
  }
  return { accountId: choice }
}

export function DataImportPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setHasUploadedData = useAppStore((s) => s.setHasUploadedData)
  const setLastImportSummary = useAppStore((s) => s.setLastImportSummary)
  const lastImportSummary = useAppStore((s) => s.lastImportSummary)
  const [phase, setPhase] = useState<Phase>('idle')
  const [summary, setSummary] = useState<ImportParseResult | null>(null)
  const [fileLabel, setFileLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [accountChoice, setAccountChoice] = useState('')
  const [newAccountName, setNewAccountName] = useState('')
  const fileHistory = useTransactionFiles()
  const accountsQuery = useAccounts()

  const accountNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of accountsQuery.data?.accounts ?? []) {
      m.set(a.id, a.name)
    }
    return m
  }, [accountsQuery.data?.accounts])

  const accountLoadError = accountsQuery.isError
  const canImport = importSatisfied(
    accountLoadError,
    accountChoice,
    newAccountName,
  )

  const handleFile = async (file: File) => {
    if (!canImport) return
    setError(null)
    setPhase('parsing')
    setFileLabel(file.name)
    try {
      const result = await postImport(
        file,
        importAccountParam(accountLoadError, accountChoice, newAccountName),
      )
      setSummary(result)
      setLastImportSummary(result)
      setHasUploadedData(true)
      // `refetchType: 'all'` so inactive queries (e.g. dashboard metrics) refetch
      // while on this route — the default only refetches queries with active observers.
      void queryClient.invalidateQueries({
        queryKey: ['metrics'],
        refetchType: 'all',
      })
      void queryClient.invalidateQueries({
        queryKey: ['transactions'],
        refetchType: 'all',
      })
      void queryClient.invalidateQueries({
        queryKey: ['review-queue'],
        refetchType: 'all',
      })
      void queryClient.invalidateQueries({
        queryKey: ['transaction-files'],
        refetchType: 'all',
      })
      void queryClient.invalidateQueries({
        queryKey: ['accounts'],
        refetchType: 'all',
      })
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
          disabled={!lastImportSummary?.importFileId}
          onClick={() => {
            const id = lastImportSummary?.importFileId
            if (!id) return
            navigate(
              `/import/review-transactions?transactionFileId=${encodeURIComponent(id)}`,
            )
          }}
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
        <div className="space-y-6">
          <div className="max-w-md space-y-2">
            <label
              htmlFor="import-account"
              className="block text-sm font-medium text-zinc-200"
            >
              Account
            </label>
            {accountsQuery.isPending && (
              <p className="text-sm text-zinc-500">Loading accounts…</p>
            )}
            {accountsQuery.isError && (
              <div className="space-y-2">
                <p className="text-sm text-amber-200/90">
                  Could not load accounts. Enter a new account name to import, or
                  refresh the page.
                </p>
                <input
                  id="import-new-account-fallback"
                  type="text"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="e.g. Chase Checking"
                  className="w-full rounded-lg border border-white/[0.12] bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
              </div>
            )}
            {accountsQuery.isSuccess && (
              <select
                id="import-account"
                className="w-full rounded-lg border border-white/[0.12] bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                value={accountChoice}
                onChange={(e) => {
                  setAccountChoice(e.target.value)
                  if (e.target.value !== NEW_ACCOUNT) {
                    setNewAccountName('')
                  }
                }}
              >
                <option value="" disabled>
                  Select an account…
                </option>
                {accountsQuery.data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value={NEW_ACCOUNT}>New account…</option>
              </select>
            )}
            {accountChoice === NEW_ACCOUNT && (
              <div className="pt-1">
                <label
                  htmlFor="import-new-account"
                  className="sr-only"
                >
                  New account name
                </label>
                <input
                  id="import-new-account"
                  type="text"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="e.g. Chase Checking"
                  className="w-full rounded-lg border border-white/[0.12] bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
              </div>
            )}
            <p className="text-xs text-zinc-500">
              Every import is stored against one account. Pick an existing
              one or name a new account for this file.
            </p>
          </div>
          <ImportDropzone
            onFileSelected={(f) => void handleFile(f)}
            disabled={!canImport}
            disabledMessage="Choose an account (or a new account name) above before uploading a file."
          />
        </div>
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
            navigate(
              `/import/review-transactions?transactionFileId=${encodeURIComponent(summary.importFileId)}`,
            )
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
            {fileHistory.data.transaction_files.map((f) => {
              const canReview = f.result.rowCount > 0
              return (
                <li
                  key={f.id}
                  className="flex flex-col gap-2 py-3 first:pt-0"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-medium text-zinc-200">
                        {f.source.name}
                      </p>
                      <p className="text-sm text-zinc-400">
                        Account:{' '}
                        {f.account_id
                          ? (accountNameById.get(f.account_id) ?? f.account_id)
                          : '—'}
                      </p>
                      <p className="text-sm text-zinc-500">
                        <time
                          dateTime={new Date(
                            f.timing.completed_at,
                          ).toISOString()}
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
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0 self-start"
                      disabled={!canReview}
                      title={
                        canReview
                          ? undefined
                          : 'This import recorded no new rows to review.'
                      }
                      onClick={() =>
                        navigate(
                          `/import/review-transactions?transactionFileId=${encodeURIComponent(f.id)}`,
                        )
                      }
                    >
                      Review import
                    </Button>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {f.result.knownMerchants} known merchants,{' '}
                    {f.result.unknownMerchants} unknown
                    {f.result.existingTransactionsUpdated > 0 && (
                      <>
                        {' '}
                        · {f.result.existingTransactionsUpdated} existing
                        updated
                      </>
                    )}
                    {f.source.content_type && (
                      <span> · {f.source.content_type}</span>
                    )}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
