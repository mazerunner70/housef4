import type { FinanceRepository, TransactionFileRecord } from '@housef4/db';
import { normalizeIso4217Currency } from '@housef4/db';

import { find } from './utils/lodashImport';

/**
 * Authoritative batch currency for an import (`import_transaction_files.md` §4.2).
 * Decided at ingest: file hint (e.g. OFX `CURDEF`) → latest prior file for the account → profile default.
 */
export async function resolveImportCurrency(
  repo: FinanceRepository,
  userId: string,
  accountId: string,
  fileCurrencyHint?: string,
): Promise<string> {
  const fromFile = normalizeIso4217Currency(fileCurrencyHint);
  if (fromFile) return fromFile;

  const files: TransactionFileRecord[] = await repo.listTransactionFiles(userId);
  const prior = find(
    files,
    (f) =>
      f.account_id === accountId &&
      normalizeIso4217Currency(f.format.currency) !== undefined,
  );
  const fromPrior = prior && normalizeIso4217Currency(prior.format.currency);
  if (fromPrior) return fromPrior;

  return repo.getDefaultCurrencyCode(userId);
}
