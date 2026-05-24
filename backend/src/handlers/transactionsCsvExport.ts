import { getFinanceRepository } from '@housef4/db';

import { getLog } from '../requestLogContext';
import { cleanMerchantForClustering } from '../services/import/clustering';
import type { InternalRequest } from '../types';

export async function getTransactionsCsvExport(
  userId: string,
  req: InternalRequest,
) {
  const log = getLog();
  const t0 = Date.now();
  const transactionFileId =
    req.query?.transactionFileId?.trim() || undefined;
  const clusterId = req.query?.clusterId?.trim() || undefined;
  const csv = await getFinanceRepository().exportTransactionsCsv(userId, {
    transactionFileId,
    clusterId,
    resolveCleanedMerchant: (t) =>
      t.cleaned_merchant ?? cleanMerchantForClustering(t.raw_merchant),
  });
  log.info('transactions.csv.export', {
    durationMs: Date.now() - t0,
    transactionFileId: transactionFileId ?? null,
    clusterId: clusterId ?? null,
  });
  return csv;
}
