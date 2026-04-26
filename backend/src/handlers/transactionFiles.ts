import { getFinanceRepository } from '@housef4/db';

import { getLog } from '../requestLogContext';

export async function getTransactionFilesPayload(userId: string) {
  const log = getLog();
  const t0 = Date.now();
  const transaction_files = await getFinanceRepository().listTransactionFiles(
    userId,
  );
  log.info('transactionFiles.loaded', {
    durationMs: Date.now() - t0,
    count: transaction_files.length,
  });
  return { transaction_files };
}
