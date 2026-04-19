import { createHash } from 'node:crypto';

/** Stable production cluster id from normalized cleaned merchant text (medoid or singleton). */
export function stableClusterIdFromCleaned(cleanedMerchant: string): string {
  const n = cleanedMerchant.trim().toLowerCase().replace(/\s+/g, ' ');
  const h = createHash('sha256').update(n).digest('hex').slice(0, 16);
  return `CL_${h}`;
}
