import { getFinanceRepository } from '@housef4/db';

import { getLog } from '../requestLogContext';

export async function getReviewQueuePayload(userId: string) {
  const log = getLog();
  const t0 = Date.now();
  const repo = getFinanceRepository();
  const [pending, default_currency] = await Promise.all([
    repo.listPendingClusters(userId),
    repo.getDefaultCurrencyCode(userId),
  ]);
  log.info('reviewQueue.loaded', {
    durationMs: Date.now() - t0,
    count: pending.length,
  });
  return {
    default_currency,
    pending_clusters: pending.map((c) => ({
      cluster_id: c.cluster_id,
      sample_merchants: c.sample_merchants,
      total_transactions: c.total_transactions,
      total_amount: c.total_amount,
      suggested_category: c.suggested_category,
      ...(c.currency && { currency: c.currency }),
    })),
  };
}
