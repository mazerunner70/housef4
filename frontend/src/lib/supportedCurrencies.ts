/** ISO 4217 codes offered when creating a new account (matches backend `@housef4/money`). */
export const SUPPORTED_CREATE_ACCOUNT_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
] as const

export type SupportedCreateAccountCurrency =
  (typeof SUPPORTED_CREATE_ACCOUNT_CURRENCIES)[number]
