import type {
  FinanceRepository,
  TransactionFileCurrencyChoice,
  TransactionFileRecord,
} from '@housef4/db';
import { normalizeIso4217Currency } from '@housef4/db';

import { find } from './utils/lodashImport';

export type ResolvedImportCurrency = Readonly<{
  currency: string;
  currencyChoice: TransactionFileCurrencyChoice;
}>;

/**
 * Authoritative batch currency for an import (`import_transaction_files.md` §4.2).
 * Decided at ingest: file hint (e.g. OFX `CURDEF`) → latest prior file for the account → profile default.
 */
export async function resolveImportCurrency(
  repo: FinanceRepository,
  userId: string,
  accountId: string,
  fileCurrencyHint?: string,
): Promise<ResolvedImportCurrency> {
  const fromFile = normalizeIso4217Currency(fileCurrencyHint);
  if (fromFile) {
    return { currency: fromFile, currencyChoice: 'file_hint' };
  }

  const files: TransactionFileRecord[] = await repo.listTransactionFiles(userId);
  const prior = find(
    files,
    (f) =>
      f.account_id === accountId &&
      normalizeIso4217Currency(f.format.currency) !== undefined,
  );
  const fromPrior = prior && normalizeIso4217Currency(prior.format.currency);
  if (fromPrior) {
    return { currency: fromPrior, currencyChoice: 'prior_account_file' };
  }

  const profileDefault = await repo.getDefaultCurrencyCode(userId);
  return { currency: profileDefault, currencyChoice: 'profile_default' };
}
