import { getFinanceRepository } from '@housef4/db';

import { getLog } from '../requestLogContext';

export async function getBackupExportPayload(userId: string) {
  const log = getLog();
  const t0 = Date.now();
  const body = await getFinanceRepository().exportBackupSnapshot(userId);
  log.info('backup.export.response', {
    durationMs: Date.now() - t0,
    accountCount: body.accounts.length,
    transactionCount: body.transactions.length,
    clusterCount: body.clusters.length,
    transactionFileCount: body.transaction_files.length,
  });
  return body;
}
