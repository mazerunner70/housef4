import { useCallback, useEffect, useRef, useState } from 'react'

import {
  downloadBlobAsFile,
  getBackupExport,
} from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { RestoreStuckBanner } from '@/features/backup/components/RestoreStuckBanner'
import { RestoreWizard } from '@/features/backup/components/RestoreWizard'
import { RESTORE_STUCK_BANNER_STORAGE_KEY } from '@/features/backup/constants'

function readStuckBannerFlag(): boolean {
  try {
    return sessionStorage.getItem(RESTORE_STUCK_BANNER_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function clearStuckBannerFlag() {
  try {
    sessionStorage.removeItem(RESTORE_STUCK_BANNER_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function DataBackupSettingsPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [stuckBannerOpen, setStuckBannerOpen] = useState(() =>
    readStuckBannerFlag(),
  )
  const [abortNotice, setAbortNotice] = useState<string | null>(null)
  const abortNoticeDismissRef = useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null)

  const showAbortNotice = useCallback((message: string) => {
    if (abortNoticeDismissRef.current !== null) {
      globalThis.clearTimeout(abortNoticeDismissRef.current)
    }
    setAbortNotice(message)
    abortNoticeDismissRef.current = globalThis.setTimeout(() => {
      abortNoticeDismissRef.current = null
      setAbortNotice(null)
    }, 8000)
  }, [])

  useEffect(() => {
    return () => {
      if (abortNoticeDismissRef.current !== null) {
        globalThis.clearTimeout(abortNoticeDismissRef.current)
      }
    }
  }, [])

  const handleAbortSucceeded = useCallback(() => {
    clearStuckBannerFlag()
    setStuckBannerOpen(false)
    showAbortNotice(
      'Restore lock cleared. Refresh if anything looks stale, then try again.',
    )
  }, [showAbortNotice])

  const handleRestoreLockUncertainty = useCallback(() => {
    setStuckBannerOpen(true)
  }, [])

  const handleDownload = async () => {
    setError(null)
    setSuccess(false)
    setLoading(true)
    try {
      const { blob, filename } = await getBackupExport()
      downloadBlobAsFile(blob, filename)
      setSuccess(true)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Backup failed'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
          Your data
        </h1>
        <p className="mt-2 max-w-2xl text-zinc-400">
          Backups are sent over HTTPS. The file you download contains your
          app-held financial metadata — keep it on trusted storage or an
          encrypted disk.
        </p>
      </header>

      {abortNotice && (
        <output
          className="block rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
          aria-live="polite"
          aria-label="Restore cleanup status"
        >
          {abortNotice}
        </output>
      )}

      <RestoreStuckBanner
        open={stuckBannerOpen}
        onAbortSucceeded={handleAbortSucceeded}
      />

      <section
        className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-6 sm:p-8"
        aria-labelledby="backup-heading"
      >
        <h2
          id="backup-heading"
          className="text-lg font-semibold text-zinc-100"
        >
          Backup (export)
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Download a JSON snapshot you can use to restore this app on another
          device or after a reset.
        </p>
        <ul className="mt-4 list-inside list-disc space-y-1.5 text-sm text-zinc-300">
          <li>Accounts, transactions, and category clusters</li>
          <li>Import history (file metadata — not raw bank uploads in V1)</li>
          <li>Profile and metrics where stored</li>
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button
            type="button"
            disabled={loading}
            onClick={() => void handleDownload()}
          >
            Download backup
          </Button>
          {loading && (
            <div className="inline-flex items-center gap-2 text-sm text-zinc-400">
              <Spinner label="Preparing download" />
              <span aria-hidden>Preparing download…</span>
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-zinc-500">Keep this file private.</p>

        {success && (
          <output
            className="mt-4 block rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
            aria-live="polite"
            aria-label="Backup download status"
          >
            Backup downloaded.
          </output>
        )}

        {error && (
          <div className="mt-4 space-y-3">
            <p
              role="alert"
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
              Could not prepare backup ({error}). Check your connection and try
              again.
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => void handleDownload()}
            >
              Try again
            </Button>
          </div>
        )}
      </section>

      <section
        className="rounded-2xl border border-amber-500/25 bg-amber-950/20 p-6 sm:p-8"
        aria-labelledby="restore-heading"
      >
        <h2
          id="restore-heading"
          className="text-lg font-semibold text-amber-50"
        >
          Restore (destructive)
        </h2>
        <p className="mt-2 text-sm text-amber-100/85">
          Upload a backup you exported from this app. Restore replaces{' '}
          <strong className="font-semibold text-amber-50">everything</strong>{' '}
          stored for your account — there is no merge.
        </p>
        <div className="mt-8 border-t border-amber-500/15 pt-8">
          <RestoreWizard
            onRestoreLockUncertainty={handleRestoreLockUncertainty}
          />
        </div>
      </section>
    </div>
  )
}
