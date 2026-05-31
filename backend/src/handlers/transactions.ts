import {
  buildFileCurrencyLookup,
  canonicalAmountToWireMajor,
  currencyForTransaction,
  fileAmountToWireMajor,
  getFinanceRepository,
} from '@housef4/db';

import { getLog } from '../requestLogContext';
import { cleanMerchantForClustering } from '../services/import/clustering';

export async function getTransactionsPayload(
  userId: string,
  opts?: { transactionFileId?: string; clusterId?: string },
) {
  const log = getLog();
  const t0 = Date.now();
  const fileId = opts?.transactionFileId?.trim() || undefined;
  const clusterId = opts?.clusterId?.trim() || undefined;
  const repo = getFinanceRepository();
  const [accounts, files] = await Promise.all([
    repo.listAccounts(userId),
    repo.listTransactionFiles(userId),
  ]);
  const currencyForFile = buildFileCurrencyLookup(accounts, files);
  let rows =
    fileId === undefined
      ? await repo.listTransactions(userId)
      : await repo.listTransactionsByFileId(userId, fileId);
  if (clusterId !== undefined) {
    rows = rows.filter((t) => t.cluster_id === clusterId);
  }
  log.info('transactions.loaded', {
    durationMs: Date.now() - t0,
    count: rows.length,
    byTransactionFile: Boolean(fileId),
    clusterId: clusterId ?? null,
  });
  return {
    transactions: rows.map((t) => {
      const currency = currencyForTransaction(t, currencyForFile);
      const row: Record<string, unknown> = {
        id: t.id,
        date: t.date,
        raw_merchant: t.raw_merchant,
        cleaned_merchant: t.cleaned_merchant ?? cleanMerchantForClustering(t.raw_merchant),
        amount: canonicalAmountToWireMajor(t, currency),
        cluster_id: t.cluster_id,
        category: t.category,
        status: t.status,
        is_recurring: t.is_recurring,
        transaction_file_id: t.transaction_file_id,
        currency,
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
      if (t.pairing_id !== undefined) {
        row.pairing_id = t.pairing_id;
      }
      if (t.pairing_source !== undefined) {
        row.pairing_source = t.pairing_source;
      }
      if (t.pairing_confidence !== undefined) {
        row.pairing_confidence = t.pairing_confidence;
      }
      const fileAmountMajor = fileAmountToWireMajor(t, currency);
      if (fileAmountMajor !== undefined) {
        row.file_amount = fileAmountMajor;
      }
      return row;
    }),
  };
}
