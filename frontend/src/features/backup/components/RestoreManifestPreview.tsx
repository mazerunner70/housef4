import type { BackupManifestPreview } from '@/lib/parseHousef4BackupManifest'

type RestoreManifestPreviewProps = {
  manifest: BackupManifestPreview
}

function formatExportedAt(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ms))
  } catch {
    return String(ms)
  }
}

export function RestoreManifestPreview({
  manifest,
}: RestoreManifestPreviewProps) {
  const { counts } = manifest

  return (
    <div className="space-y-4 text-sm text-zinc-300">
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">
            Schema version
          </dt>
          <dd className="mt-0.5 font-medium text-zinc-100">
            {manifest.backup_schema_version}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-500">
            Exported
          </dt>
          <dd className="mt-0.5 font-medium text-zinc-100">
            {formatExportedAt(manifest.exported_at)}
          </dd>
        </div>
      </dl>

      <div className="rounded-xl border border-white/[0.08] bg-zinc-950/50 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Contents (counts)
        </p>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          <li>Accounts: {counts.accounts}</li>
          <li>Transactions: {counts.transactions}</li>
          <li>Clusters: {counts.clusters}</li>
          <li>Import files (metadata): {counts.transaction_files}</li>
          <li>Profile snapshot: {counts.has_profile ? 'yes' : 'no'}</li>
          <li>Metrics snapshot: {counts.has_metrics ? 'yes' : 'no'}</li>
        </ul>
      </div>
    </div>
  )
}
