import { createHash } from 'node:crypto';

/** Lowercase hex SHA-256 over the raw upload bytes (`POST /api/imports` file part). */
export function computeImportBlobContentSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
