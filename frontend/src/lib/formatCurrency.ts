import { SUPPORTED_CREATE_ACCOUNT_CURRENCIES } from './supportedCurrencies'

const FALLBACK = 'USD'

const SUPPORTED_CURRENCY_SET = new Set<string>(SUPPORTED_CREATE_ACCOUNT_CURRENCIES)

function isSupportedCurrency(code: string | undefined | null): code is string {
  if (typeof code !== 'string') return false
  return SUPPORTED_CURRENCY_SET.has(code.trim().toUpperCase())
}

/** Normalize currency for display; falls back to USD when unsupported. */
export function resolveCurrencyCode(fromRow?: string | null): string {
  if (isSupportedCurrency(fromRow)) return fromRow.trim().toUpperCase()
  return FALLBACK
}

export function formatCurrencyAmount(
  amount: number,
  currencyCode: string,
): string {
  const code = resolveCurrencyCode(currencyCode)
  try {
    return amount.toLocaleString(undefined, { style: 'currency', currency: code })
  } catch {
    return amount.toLocaleString(undefined, {
      style: 'currency',
      currency: FALLBACK,
    })
  }
}

/** Chart Y-axis tick formatter for a selected metrics currency. */
export function formatChartAxisTick(
  value: unknown,
  domainMax: number,
  currencyCode: string,
): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return ''
  const code = resolveCurrencyCode(currencyCode)
  const cap =
    Number.isFinite(domainMax) && domainMax > 0
      ? domainMax
      : Math.max(Math.abs(n), 1)
  const useCompact = cap >= 1_000_000
  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: code,
    minimumFractionDigits: 0,
    maximumFractionDigits: useCompact ? 2 : 0,
    ...(useCompact ? { notation: 'compact' as const } : {}),
  }
  try {
    return n.toLocaleString(undefined, options)
  } catch {
    return n.toLocaleString(undefined, {
      style: 'currency',
      currency: FALLBACK,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  }
}
