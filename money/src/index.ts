/**
 * Canonical monetary representation for housef4 (HOU-32 / account-scoped currency).
 */

export { MoneyError } from './errors';

export {
  ALL_CURRENCIES,
  compareCurrencyIds,
  currencyEquals,
  currencyScale,
  Currency,
  detectAmountStringCurrency,
  formatCurrencyDescriptor,
  formatCurrencyLabel,
  isCurrencyId,
  parseCurrency,
  resolveCurrency,
  validateAmountStringSymbol,
  SUPPORTED_CREATE_ACCOUNT_CURRENCIES,
  type CurrencyId,
  type SupportedCreateAccountCurrency,
} from './currency';

export {
  abs,
  add,
  formatAmount,
  fromMajor,
  money,
  Money,
  negate,
  pairingIsExact,
  pairingResidual,
  pairingResidualAbs,
  parseDecimalString,
  toMajor,
} from './money';

export {
  readStoredAmount,
  storedAmountFieldsToWireMajor,
  writeStoredAmountFields,
  type ReadAmountResult,
  type StoredAmountFields,
} from './stored';
