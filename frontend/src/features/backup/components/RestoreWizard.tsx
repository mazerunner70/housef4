import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

import {
  ApiHttpError,
  postBackupRestore,
} from '@/api/client'
import { Button } from '@/components/ui/Button'
import {
  parseHousef4BackupManifest,
  type BackupManifestPreview,
} from '@/lib/parseHousef4BackupManifest'
import type { BackupRestoreResponse } from '@/lib/types'

import { RESTORE_STUCK_BANNER_STORAGE_KEY } from '../constants'
import { RestoreFilePicker } from './RestoreFilePicker'
import { RestoreManifestPreview } from './RestoreManifestPreview'
import { RestoreProgressPanel } from './RestoreProgressPanel'

const CONFIRM_TOKEN = 'RESTORE'

type Step = 1 | 2 | 3 | 4

function flagRestoreStuckSession() {
  try {
    sessionStorage.setItem(RESTORE_STUCK_BANNER_STORAGE_KEY, '1')
  } catch {
    /* ignore quota / privacy mode */
  }
}

function clearRestoreStuckSession() {
  try {
    sessionStorage.removeItem(RESTORE_STUCK_BANNER_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Reads top-level `error` string from JSON error bodies when present. */
function apiErrorDetail(bodyText: string): string | undefined {
  const t = bodyText.trim()
  if (!t) return undefined
  try {
    const data = JSON.parse(t) as { error?: string }
    return typeof data.error === 'string' ? data.error : undefined
  } catch {
    return undefined
  }
}

export function RestoreWizard({
  onRestoreLockUncertainty,
}: Readonly<{
  onRestoreLockUncertainty: () => void
}>) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const headingRef = useRef<HTMLHeadingElement>(null)

  const [step, setStep] = useState<Step>(1)
  const [file, setFile] = useState<File | null>(null)
  const [manifest, setManifest] = useState<BackupManifestPreview | null>(null)
  const [manifestParseError, setManifestParseError] = useState<string | null>(
    null,
  )

  const [confirmChecked, setConfirmChecked] = useState(false)
  const [confirmTyped, setConfirmTyped] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [uploadPhase, setUploadPhase] = useState<'uploading' | 'restoring'>(
    'uploading',
  )
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState<BackupRestoreResponse | null>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [step, done])

  const invalidateFinanceCaches = () => {
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
  }

  const resetFlow = () => {
    setStep(1)
    setFile(null)
    setManifest(null)
    setManifestParseError(null)
    setConfirmChecked(false)
    setConfirmTyped('')
    setSubmitting(false)
    setSubmitError(null)
    setDone(null)
  }

  const goNextFromStep1 = async () => {
    if (!file) return
    setManifestParseError(null)
    let text: string
    try {
      text = await file.text()
    } catch {
      setManifestParseError(
        'Could not read this file. Try another export or download the backup again.',
      )
      return
    }
    const manifest = parseHousef4BackupManifest(text)
    if (!manifest) {
      setManifestParseError(
        'This file doesn’t look like a Housef4 backup. Use a JSON file exported from this app (schema version 1).',
      )
      return
    }
    setManifest(manifest)
    setStep(2)
  }

  const canStartRestore =
    confirmChecked && confirmTyped === CONFIRM_TOKEN && file !== null

  const handleStartRestore = async () => {
    if (!file || !canStartRestore) return
    setSubmitError(null)
    setSubmitting(true)
    setUploadPhase('uploading')
    const phaseTimer = globalThis.setTimeout(() => {
      setUploadPhase('restoring')
    }, 550)
    try {
      const result = await postBackupRestore(file)
      clearRestoreStuckSession()
      invalidateFinanceCaches()
      setDone(result)
    } catch (e) {
      if (e instanceof ApiHttpError) {
        const detail = apiErrorDetail(e.body)
        if (e.status === 403) {
          setSubmitError(
            'This backup belongs to another account. Sign in as the right user or choose a different file.',
          )
        } else if (e.status === 400) {
          setSubmitError(
            detail ??
              'The backup failed validation or uses an unsupported layout. Export a fresh backup from the app and try again.',
          )
        } else if (e.status === 401) {
          setSubmitError(
            'You are not signed in or your session expired. Sign in and try again.',
          )
        } else if (e.status === 409) {
          flagRestoreStuckSession()
          onRestoreLockUncertainty()
          setSubmitError(
            'Another restore is already in progress. Clear the restore lock below, refresh if needed, then retry.',
          )
        } else if (e.status === 500) {
          flagRestoreStuckSession()
          onRestoreLockUncertainty()
          setSubmitError(
            detail ??
              'Restore failed on the server. Clear the restore lock when prompted, refresh, then try again or contact support.',
          )
        } else {
          setSubmitError(detail ?? e.message)
        }
      } else {
        setSubmitError(e instanceof Error ? e.message : 'Restore failed')
      }
    } finally {
      globalThis.clearTimeout(phaseTimer)
      setSubmitting(false)
      setUploadPhase('uploading')
    }
  }

  if (done) {
    const r = done.restored
    return (
      <div className="space-y-6">
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="text-lg font-semibold text-zinc-100 outline-none"
        >
          Restore complete
        </h3>
        <output
          className="block rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100"
          aria-live="polite"
        >
          <p className="font-medium text-emerald-50">Your data was restored.</p>
          <ul className="mt-3 grid gap-1 sm:grid-cols-2">
            <li>Accounts: {r.accounts}</li>
            <li>Transactions: {r.transactions}</li>
            <li>Clusters: {r.clusters}</li>
            <li>Import records: {r.transaction_files}</li>
            <li>Profile: {r.profile ? 'yes' : 'no'}</li>
            <li>Metrics: {r.metrics ? 'yes' : 'no'}</li>
          </ul>
        </output>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="primary"
            onClick={() => navigate('/dashboard')}
          >
            Go to dashboard
          </Button>
          <Button type="button" variant="secondary" onClick={resetFlow}>
            Restore another backup
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        <span
          className={step >= 1 ? 'text-[var(--color-accent)]' : undefined}
          aria-current={step === 1 ? 'step' : undefined}
        >
          1 · File
        </span>
        <span aria-hidden className="text-zinc-600">
          ·
        </span>
        <span
          className={step >= 2 ? 'text-[var(--color-accent)]' : undefined}
          aria-current={step === 2 ? 'step' : undefined}
        >
          2 · Summary
        </span>
        <span aria-hidden className="text-zinc-600">
          ·
        </span>
        <span
          className={step >= 3 ? 'text-[var(--color-accent)]' : undefined}
          aria-current={step === 3 ? 'step' : undefined}
        >
          3 · Confirm
        </span>
        <span aria-hidden className="text-zinc-600">
          ·
        </span>
        <span
          className={step >= 4 ? 'text-[var(--color-accent)]' : undefined}
          aria-current={step === 4 ? 'step' : undefined}
        >
          4 · Restore
        </span>
      </div>

      {step === 1 && (
        <div className="space-y-6">
          <h3
            ref={headingRef}
            tabIndex={-1}
            id="restore-step-1-heading"
            className="text-lg font-semibold text-zinc-100 outline-none"
          >
            Choose backup file
          </h3>
          <RestoreFilePicker
            file={file}
            disabled={submitting}
            onFileSelected={(f) => {
              setFile(f)
              setManifestParseError(null)
            }}
          />
          {manifestParseError && (
            <p role="alert" className="text-sm text-red-300">
              {manifestParseError}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="primary"
              disabled={!file || submitting}
              onClick={() => void goNextFromStep1()}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 2 && manifest && (
        <div className="space-y-6">
          <h3
            ref={headingRef}
            tabIndex={-1}
            id="restore-step-2-heading"
            className="text-lg font-semibold text-zinc-100 outline-none"
          >
            Backup summary
          </h3>
          <RestoreManifestPreview manifest={manifest} />
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={() => {
                setStep(1)
                setManifest(null)
              }}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={submitting}
              onClick={() => setStep(3)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <h3
            ref={headingRef}
            tabIndex={-1}
            id="restore-step-3-heading"
            className="text-lg font-semibold text-zinc-100 outline-none"
          >
            Confirm full replace
          </h3>
          <div
            role="alert"
            className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-50"
          >
            Restoring replaces <strong className="font-semibold">all</strong>{' '}
            data in this app for your account. This cannot be undone.
          </div>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={confirmChecked}
              disabled={submitting}
              onChange={(e) => setConfirmChecked(e.target.checked)}
              className="mt-1 size-4 rounded border-zinc-600 bg-zinc-900 text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-nav-accent)]"
            />
            <span>
              I understand all current data will be{' '}
              <strong className="font-semibold text-zinc-100">
                permanently replaced.
              </strong>
            </span>
          </label>
          <div className="space-y-2">
            <label
              htmlFor="restore-confirm-token"
              className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              Type <span className="font-mono text-zinc-300">{CONFIRM_TOKEN}</span>{' '}
              to enable restore
            </label>
            <input
              id="restore-confirm-token"
              type="text"
              autoComplete="off"
              disabled={submitting}
              value={confirmTyped}
              onChange={(e) => setConfirmTyped(e.target.value)}
              className="w-full max-w-md rounded-xl border border-white/[0.12] bg-zinc-950/80 px-3 py-2.5 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-nav-accent)]"
              placeholder={CONFIRM_TOKEN}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={() => setStep(2)}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canStartRestore || submitting}
              onClick={() => setStep(4)}
            >
              Continue to restore
            </Button>
          </div>
        </div>
      )}

      {step === 4 && file && (
        <div className="space-y-6">
          <h3
            ref={headingRef}
            tabIndex={-1}
            id="restore-step-4-heading"
            className="text-lg font-semibold text-zinc-100 outline-none"
          >
            Run restore
          </h3>
          <p className="text-sm text-zinc-400">
            We upload your backup, then replace stored data in one operation.
          </p>

          {submitting ? (
            <RestoreProgressPanel phase={uploadPhase} />
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep(3)}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={!canStartRestore}
                onClick={() => void handleStartRestore()}
              >
                Start restore
              </Button>
            </div>
          )}

          {submitError && (
            <p role="alert" className="text-sm text-red-300">
              {submitError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
