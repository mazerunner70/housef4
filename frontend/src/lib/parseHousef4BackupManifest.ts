import { z } from 'zod'

/** Matches **`BACKUP_SCHEMA_VERSION_V1`** in db (`backup-schema/v1.md`). */
export const HOUSEF4_BACKUP_SCHEMA_VERSION_V1 = 1 as const

/** V1 backup envelope — validates presence/shape only; arrays are not item-checked. */
const manifestEnvelopeSchema = z
  .object({
    backup_schema_version: z.literal(HOUSEF4_BACKUP_SCHEMA_VERSION_V1),
    exported_at: z.number(),
    accounts: z.array(z.unknown()),
    transactions: z.array(z.unknown()),
    clusters: z.array(z.unknown()),
    transaction_files: z.array(z.unknown()),
    profile: z.union([z.null(), z.record(z.string(), z.unknown())]),
    metrics: z.union([z.null(), z.record(z.string(), z.unknown())]),
  })
  .transform((d) => ({
    backup_schema_version: d.backup_schema_version,
    exported_at: d.exported_at,
    counts: {
      accounts: d.accounts.length,
      transactions: d.transactions.length,
      clusters: d.clusters.length,
      transaction_files: d.transaction_files.length,
      has_profile: d.profile !== null,
      has_metrics: d.metrics !== null,
    },
  }))

export type BackupManifestPreview = z.infer<typeof manifestEnvelopeSchema>

/** Client-side v1 envelope check before restore — counts only. */
export function parseHousef4BackupManifest(
  jsonText: string,
): BackupManifestPreview | null {
  try {
    const parsed = manifestEnvelopeSchema.safeParse(JSON.parse(jsonText))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
