import {
  parseCurrency,
  SUPPORTED_CREATE_ACCOUNT_CURRENCIES,
  type Currency,
  type CurrencyId,
} from '@housef4/money';

/** Normalize ISO 4217 to a supported code string for storage and wire JSON. */
export function normalizeIso4217Currency(code?: string): CurrencyId | undefined {
  if (!code?.trim()) return undefined;
  return parseCurrency(code).id;
}

/** Parse ISO 4217 to a {@link Currency} value (throws when unsupported). */
export function parseIso4217Currency(code: string): Currency {
  return parseCurrency(code);
}

export { SUPPORTED_CREATE_ACCOUNT_CURRENCIES };
