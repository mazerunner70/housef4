import { Spinner } from '@/components/ui/Spinner'

type RestoreProgressPhase = 'uploading' | 'restoring'

type RestoreProgressPanelProps = {
  phase: RestoreProgressPhase
}

export function RestoreProgressPanel({ phase }: RestoreProgressPanelProps) {
  const label =
    phase === 'uploading' ? 'Uploading backup' : 'Restoring your data'

  return (
    <div
      className="flex flex-col items-start gap-4 rounded-xl border border-white/[0.08] bg-zinc-950/50 px-4 py-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <Spinner label={label} />
        <span className="text-sm font-medium text-zinc-200">
          {phase === 'uploading' ? 'Uploading…' : 'Restoring…'}
        </span>
      </div>
      <p className="text-xs text-zinc-500">
        Do not close this tab until the restore finishes or you are instructed
        otherwise.
      </p>
    </div>
  )
}
