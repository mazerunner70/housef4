import { normalizeIso4217Currency } from '@housef4/db';

import { HttpError } from '../../httpError';

export type ImportCurrencyContext = Readonly<{
  isNewAccount: boolean;
  clientCurrency?: string;
  /** Persisted on the ACCOUNT item; omit when the attribute is absent or empty. */
  storedAccountCurrency?: string;
  fileCurrencyHint?: string;
}>;

/**
 * Resolve authoritative import currency and reject mismatches (`409 currency_mismatch`).
 */
export function resolveAndValidateImportCurrency(
  ctx: ImportCurrencyContext,
): string {
  if (ctx.isNewAccount) {
    const chosen = normalizeIso4217Currency(ctx.clientCurrency);
    if (!chosen) {
      throw new HttpError(400, 'currency is required when creating a new account');
    }
    const hint = normalizeIso4217Currency(ctx.fileCurrencyHint);
    if (hint && hint !== chosen) {
      throw currencyMismatch(chosen, hint);
    }
    return chosen;
  }

  const stored = normalizeIso4217Currency(ctx.storedAccountCurrency);
  if (!stored) {
    const chosen =
      normalizeIso4217Currency(ctx.clientCurrency) ??
      normalizeIso4217Currency(ctx.fileCurrencyHint);
    if (!chosen) {
      throw new HttpError(
        400,
        'currency is required when the account has no currency set',
      );
    }
    const hint = normalizeIso4217Currency(ctx.fileCurrencyHint);
    if (hint && hint !== chosen) {
      throw currencyMismatch(chosen, hint);
    }
    return chosen;
  }

  const clientChosen = normalizeIso4217Currency(ctx.clientCurrency);
  const importCurrency = clientChosen ?? stored;

  const hint = normalizeIso4217Currency(ctx.fileCurrencyHint);
  if (hint && hint !== importCurrency) {
    throw currencyMismatch(importCurrency, hint);
  }

  return importCurrency;
}

function currencyMismatch(importCurrency: string, fileCurrency: string): HttpError {
  return new HttpError(409, 'Import currency does not match the file.', {
    error: 'currency_mismatch',
    message: 'Import currency does not match the file.',
    account_currency: importCurrency,
    file_currency: fileCurrency,
  });
}
