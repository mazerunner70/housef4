import { loadConfig } from '../../config';

export type ImportBlobBackend = 'off' | 'filesystem' | 's3';

export type ImportBlobConfig = Readonly<
  | { backend: 'off' }
  | { backend: 'filesystem'; localRoot: string }
  | { backend: 's3'; s3Bucket: string; awsRegion: string }
>;

function parseBackend(raw: string | undefined): ImportBlobBackend {
  const v = (raw ?? 'off').trim().toLowerCase();
  if (v === 'off' || v === 'filesystem' || v === 's3') return v;
  throw new Error(`Invalid IMPORT_BLOB_BACKEND: ${raw}`);
}

/** Reads `IMPORT_BLOB_*` env vars (`import_file_blob_storage.md` §9). */
export function loadImportBlobConfig(): ImportBlobConfig {
  const backend = parseBackend(process.env.IMPORT_BLOB_BACKEND);
  if (backend === 'off') return { backend: 'off' };

  if (backend === 'filesystem') {
    const localRoot =
      process.env.IMPORT_BLOB_LOCAL_ROOT?.trim() ||
      `${process.cwd()}/var/housef4/import-blobs`;
    return { backend: 'filesystem', localRoot };
  }

  const s3Bucket = process.env.IMPORT_BLOB_S3_BUCKET?.trim();
  if (!s3Bucket) {
    throw new Error('IMPORT_BLOB_S3_BUCKET is required when IMPORT_BLOB_BACKEND=s3');
  }
  const { awsRegion } = loadConfig();
  if (!awsRegion) {
    throw new Error('AWS_REGION is required when IMPORT_BLOB_BACKEND=s3');
  }
  return { backend: 's3', s3Bucket, awsRegion };
}
