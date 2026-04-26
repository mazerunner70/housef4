import { getFinanceRepository } from '@housef4/db';

import { getLog } from '../requestLogContext';
import { cleanMerchantForClustering } from '../services/import/merchantNormalize';

export async function getTransactionsPayload(userId: string) {
  const log = getLog();
  const t0 = Date.now();
  const rows = await getFinanceRepository().listTransactions(userId);
  log.info('transactions.loaded', {
    durationMs: Date.now() - t0,
    count: rows.length,
  });
  return {
    transactions: rows.map((t) => {
      const row: Record<string, unknown> = {
        id: t.id,
        date: t.date,
        raw_merchant: t.raw_merchant,
        cleaned_merchant: t.cleaned_merchant ?? cleanMerchantForClustering(t.raw_merchant),
        amount: t.amount,
        cluster_id: t.cluster_id,
        category: t.category,
        status: t.status,
        is_recurring: t.is_recurring,
      };
      if (t.suggested_category !== undefined) {
        row.suggested_category = t.suggested_category;
      }
      if (t.category_confidence !== undefined) {
        row.category_confidence = t.category_confidence;
      }
      if (t.match_type !== undefined) {
        row.match_type = t.match_type;
      }
      return row;
    }),
  };
}
