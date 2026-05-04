import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import {
  ApiHttpError,
  postBackupRestoreAbortWithRetries,
} from '@/api/client'
import { Button } from '@/components/ui/Button'

type RestoreStuckBannerProps = {
  open: boolean
  onAbortSucceeded: () => void
}

export function RestoreStuckBanner({
  open,
  onAbortSucceeded,
}: Readonly<RestoreStuckBannerProps>) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAbort = async () => {
    setError(null)
    setBusy(true)
    try {
      await postBackupRestoreAbortWithRetries()
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
      onAbortSucceeded()
    } catch (e) {
      let message = 'Abort failed'
      if (e instanceof ApiHttpError) {
        message = `${e.status} ${e.message}`
      } else if (e instanceof Error) {
        message = e.message
      }
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      role="alert"
      className="rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-4 sm:px-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-amber-100">
            A restore may still be locked
          </p>
          <p className="text-sm text-amber-100/85">
            Clearing the lock runs cleanup first so you are not blocked by a{' '}
            <strong className="font-medium">409</strong>
            {' '}on retry. If staging cleanup was incomplete, we retry automatically
            on partial errors (
            <strong className="font-medium">500</strong>). Refresh after cleanup
            before restoring again if problems persist.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          aria-busy={busy}
          className="shrink-0 border-amber-500/40 bg-amber-950/40 text-amber-50 hover:bg-amber-900/40"
          onClick={() => void handleAbort()}
        >
          {busy ? 'Clearing…' : 'Clear restore lock'}
        </Button>
      </div>
      {error && (
        <output className="mt-3 block text-sm text-red-200" aria-live="polite">
          {error}
        </output>
      )}
    </div>
  )
}
