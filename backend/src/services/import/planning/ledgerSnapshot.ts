import type { FinanceRepository, TransactionRecord } from '@housef4/db';

/**
 * Read-once view of the committed ledger for import planning (§4.2 stage 6).
 * Thread through pairing, clustering, and persist-intent builders — do not re-fetch.
 */
export type LedgerSnapshot = Readonly<{
  transactions: TransactionRecord[];
  fileIdToAccountId: ReadonlyMap<string, string>;
}>;

/**
 * Single read pass: `listTransactions` + `listTransactionFiles` → file→account map.
 */
export async function buildLedgerSnapshot(
  userId: string,
  repo: FinanceRepository,
): Promise<LedgerSnapshot> {
  const [transactions, transactionFiles] = await Promise.all([
    repo.listTransactions(userId),
    repo.listTransactionFiles(userId),
  ]);
  const fileIdToAccountId = new Map(
    transactionFiles.map((f) => [f.id, f.account_id] as const),
  );
  return { transactions, fileIdToAccountId };
}
