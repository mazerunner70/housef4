import { MoneyError } from './errors';

/** Supported ISO 4217 currency codes (account creation and ingest). */
export type CurrencyId = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD';

export type SupportedCreateAccountCurrency = CurrencyId;

export interface Currency {
  readonly id: CurrencyId;
  readonly name: string;
  readonly symbol: string;
  /**
   * ISO 4217 minor-unit exponent: one major unit = 10^scale minor units
   * (USD scale 2 → 100 cents per dollar).
   */
  readonly scale: number;
}

function defineCurrency(
  id: CurrencyId,
  name: string,
  symbol: string,
  scale: number,
): Currency {
  if (!Number.isInteger(scale) || scale < 0 || scale > 8) {
    throw new MoneyError(`Invalid scale for ${id}: ${scale}`);
  }
  return Object.freeze({ id, name, symbol, scale });
}

/** Closed set of supported currencies. */
export const Currency = Object.freeze({
  USD: defineCurrency('USD', 'US Dollar', '$', 2),
  EUR: defineCurrency('EUR', 'Euro', '€', 2),
  GBP: defineCurrency('GBP', 'British Pound', '£', 2),
  JPY: defineCurrency('JPY', 'Japanese Yen', '¥', 0),
  CAD: defineCurrency('CAD', 'Canadian Dollar', 'CA$', 2),
  AUD: defineCurrency('AUD', 'Australian Dollar', 'A$', 2),
}) satisfies Record<CurrencyId, Currency>;

const CURRENCY_BY_ID: Readonly<Record<CurrencyId, Currency>> = Currency;

const CURRENCY_ID_SET = new Set<string>(Object.keys(Currency));

/** ISO codes offered in the create-account UI (same order as {@link Currency}). */
export const SUPPORTED_CREATE_ACCOUNT_CURRENCIES: readonly CurrencyId[] = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
] as const;

/** All supported {@link Currency} values. */
export const ALL_CURRENCIES: readonly Currency[] = SUPPORTED_CREATE_ACCOUNT_CURRENCIES.map(
  (id) => CURRENCY_BY_ID[id],
);

export function isCurrencyId(code: string): code is CurrencyId {
  return CURRENCY_ID_SET.has(code.trim().toUpperCase());
}

/** Parse an ISO 4217 code; throws if missing or unsupported. */
export function parseCurrency(code: string): Currency {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new MoneyError('Currency code is required');
  }
  const id = code.trim().toUpperCase();
  if (!isCurrencyId(id)) {
    throw new MoneyError(`Unsupported currency: ${code}`);
  }
  return CURRENCY_BY_ID[id];
}

/** Resolve a {@link Currency} instance or ISO code string; throws when the string is invalid. */
export function resolveCurrency(input: Currency | string): Currency {
  if (typeof input === 'string') {
    return parseCurrency(input);
  }
  return input;
}

/** Minor-unit exponent for a currency (see {@link Currency.scale}). */
export function currencyScale(input: Currency | string): number {
  return resolveCurrency(input).scale;
}

/** Format currency metadata for UI labels. */
export function formatCurrencyLabel(currency: Currency | string): string {
  const c = resolveCurrency(currency);
  return `${c.name} (${c.id})`;
}

/** Format using symbol and code, e.g. `$ USD`. */
export function formatCurrencyDescriptor(currency: Currency | string): string {
  const c = resolveCurrency(currency);
  return `${c.symbol} ${c.id}`;
}

export function currencyEquals(a: Currency | string, b: Currency | string): boolean {
  return resolveCurrency(a).id === resolveCurrency(b).id;
}

export function compareCurrencyIds(a: Currency | string, b: Currency | string): number {
  return resolveCurrency(a).id.localeCompare(resolveCurrency(b).id);
}

/** Longest symbols first so `CA$` matches before `$`. */
const AMOUNT_STRING_SYMBOL_DETECTORS: readonly { symbol: string; currency: Currency }[] =
  [...ALL_CURRENCIES]
    .sort((a, b) => b.symbol.length - a.symbol.length)
    .map((c) => ({ symbol: c.symbol, currency: c }));

/**
 * Detect a currency from a display/CSV amount string when a known symbol appears.
 * Lone `$` maps to USD; `CA$` → CAD, `A$` → AUD.
 */
export function detectAmountStringCurrency(raw: string): Currency | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const trimmed = raw.trim();
  for (const { symbol, currency } of AMOUNT_STRING_SYMBOL_DETECTORS) {
    if (trimmed.includes(symbol)) return currency;
  }
  return undefined;
}

/**
 * When the amount string includes a currency symbol, it must match the expected currency.
 * No symbol present is allowed (bare numeric amounts).
 */
export function validateAmountStringSymbol(
  raw: string,
  currency: Currency | string,
): void {
  const expected = resolveCurrency(currency);
  const detected = detectAmountStringCurrency(raw);
  if (detected === undefined) return;
  if (detected.id !== expected.id) {
    throw new MoneyError(
      `Amount symbol ${detected.symbol} (${detected.id}) does not match expected ${expected.symbol} (${expected.id})`,
    );
  }
}
