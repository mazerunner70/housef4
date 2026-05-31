import type { TransactionFileCurrencyChoice } from './types';

/** Normalize ISO 4217 for import / profile currency fields. */
export function normalizeIso4217Currency(code?: string): string | undefined {
  const normalized = code?.trim().toUpperCase();
  if (normalized && /^[A-Z]{3}$/.test(normalized)) return normalized;
  return undefined;
}

/** Normalize stored `format.currencyChoice`; omit unknown legacy values. */
export function normalizeTransactionFileCurrencyChoice(
  value?: string,
): TransactionFileCurrencyChoice | undefined {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === 'file_hint' ||
    normalized === 'prior_account_file' ||
    normalized === 'profile_default' ||
    normalized === 'user_override'
  ) {
    return normalized;
  }
  return undefined;
}
