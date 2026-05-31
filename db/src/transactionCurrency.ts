import {
  Currency,
  parseCurrency,
  resolveCurrency,
  type CurrencyId,
} from '@housef4/money';

import type { AccountRecord, TransactionFileRecord, TransactionRecord } from './types';

export type FileCurrencyLookup = (fileId: string) => CurrencyId | undefined;

function tryParseCurrencyCode(code?: string): CurrencyId | undefined {
  if (!code?.trim()) return undefined;
  try {
    return parseCurrency(code).id;
  } catch {
    return undefined;
  }
}

/** Resolve account currency for each import file id. */
export function buildFileCurrencyLookup(
  accounts: readonly AccountRecord[],
  files: readonly TransactionFileRecord[],
): FileCurrencyLookup {
  const accountCurrencyById = new Map(
    accounts.map((a) => [a.id, tryParseCurrencyCode(a.currency)] as const),
  );
  const byFileId = new Map<string, CurrencyId>();
  for (const f of files) {
    const resolved =
      accountCurrencyById.get(f.account_id) ?? tryParseCurrencyCode(f.format.currency);
    if (resolved) {
      byFileId.set(f.id, resolved);
    }
  }
  return (fileId) => byFileId.get(fileId);
}

/** ISO 4217 code for a transaction's import file (via {@link buildFileCurrencyLookup}). */
export function currencyForTransaction(
  t: Pick<TransactionRecord, 'transaction_file_id'>,
  lookup: FileCurrencyLookup,
  fallback: CurrencyId | Currency = Currency.USD,
): CurrencyId {
  const fromFile = lookup(t.transaction_file_id);
  if (fromFile) return fromFile;
  return resolveCurrency(fallback).id;
}

/** {@link Currency} instance for amount format/parse helpers. */
export function currencyObjectForTransaction(
  t: Pick<TransactionRecord, 'transaction_file_id'>,
  lookup: FileCurrencyLookup,
  fallback: CurrencyId | Currency = Currency.USD,
): Currency {
  return resolveCurrency(currencyForTransaction(t, lookup, fallback));
}
