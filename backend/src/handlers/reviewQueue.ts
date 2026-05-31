import { totalAmountToWireMajor, getFinanceRepository } from '@housef4/db';

import { getLog } from '../requestLogContext';

export async function getReviewQueuePayload(userId: string) {
  const log = getLog();
  const t0 = Date.now();
  const repo = getFinanceRepository();
  const [pending] = await Promise.all([repo.listPendingClusters(userId)]);
  log.info('reviewQueue.loaded', {
    durationMs: Date.now() - t0,
    count: pending.length,
  });
  return {
    pending_clusters: pending.map((c) => ({
      cluster_id: c.cluster_id,
      sample_merchants: c.sample_merchants,
      total_transactions: c.total_transactions,
      total_amount: totalAmountToWireMajor(
        c.totalAmount,
        c.currency,
        c.amount_scale,
      ),
      suggested_category: c.suggested_category,
      currency: c.currency,
      ...(c.previous_category_id !== undefined && {
        previousCategoryId: c.previous_category_id,
      }),
    })),
  };
}
