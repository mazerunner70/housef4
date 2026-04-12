import { createHash, randomUUID } from 'node:crypto';

import type { FinanceRepository, ImportTransactionInput } from '@housef4/db';

import type { ParsedImportRow } from './canonical';
import { cleanMerchantForClustering } from './merchantNormalize';

export function clusterIdFromMerchant(raw: string): string {
  const n = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const h = createHash('sha256').update(n).digest('hex').slice(0, 16);
  return `CL_${h}`;
}

/**
 * Maps parsed file rows to repository inputs, using existing transactions to mark
 * known merchants / categories when a cluster was previously classified.
 */
export async function enrichImportRows(
  userId: string,
  parsed: ParsedImportRow[],
  repo: FinanceRepository,
): Promise<ImportTransactionInput[]> {
  const existing = await repo.listTransactions(userId);
  const clusterInfo = new Map<
    string,
    { hasClassified: boolean; category: string }
  >();
  for (const t of existing) {
    let g = clusterInfo.get(t.cluster_id);
    if (!g) {
      g = { hasClassified: false, category: t.category };
      clusterInfo.set(t.cluster_id, g);
    }
    if (t.status === 'CLASSIFIED') {
      g.hasClassified = true;
      g.category = t.category;
    }
  }

  const out: ImportTransactionInput[] = [];
  for (const row of parsed) {
    const cluster_id = clusterIdFromMerchant(row.raw_merchant);
    const cleaned_merchant = cleanMerchantForClustering(row.raw_merchant);
    const info = clusterInfo.get(cluster_id);
    const known = Boolean(info?.hasClassified);
    const category = known ? info!.category : 'Uncategorized';
    const status = known ? ('CLASSIFIED' as const) : ('PENDING_REVIEW' as const);
    out.push({
      user_id: userId,
      id: `txn_${randomUUID().replace(/-/g, '')}`,
      date: row.date,
      raw_merchant: row.raw_merchant,
      cleaned_merchant,
      amount: row.amount,
      cluster_id,
      category,
      status,
      is_recurring: false,
      known_merchant: known,
    });
  }
  return out;
}
