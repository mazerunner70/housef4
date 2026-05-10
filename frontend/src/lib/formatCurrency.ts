const FALLBACK = 'USD'

function isIso4217(code: string | undefined | null): code is string {
  return typeof code === 'string' && /^[A-Z]{3}$/i.test(code.trim())
}

/**
 * Picks a display code: value from the import/cluster aggregate, then profile default, else USD.
 */
export function resolveCurrencyCode(
  fromCluster?: string | null,
  profileDefault?: string | null,
): string {
  if (isIso4217(fromCluster)) return fromCluster.trim().toUpperCase()
  if (isIso4217(profileDefault)) return profileDefault.trim().toUpperCase()
  return FALLBACK
}

export function formatCurrencyAmount(
  amount: number,
  currencyCode: string,
): string {
  const code = isIso4217(currencyCode)
    ? currencyCode.trim().toUpperCase()
    : FALLBACK
  try {
    return amount.toLocaleString(undefined, { style: 'currency', currency: code })
  } catch {
    return amount.toLocaleString(undefined, {
      style: 'currency',
      currency: FALLBACK,
    })
  }
}

/**
 * Formats USD for chart Y-axis ticks: full dollars with grouping (e.g. $750, $1,000);
 * uses compact notation when the domain is very large so labels stay short.
 */
export function formatUsdChartAxisTick(value: unknown, domainMaxUsd: number): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return ''
  const cap =
    Number.isFinite(domainMaxUsd) && domainMaxUsd > 0
      ? domainMaxUsd
      : Math.max(Math.abs(n), 1)
  const useCompact = cap >= 1_000_000
  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: useCompact ? 2 : 0,
    ...(useCompact ? { notation: 'compact' as const } : {}),
  }
  try {
    return n.toLocaleString(undefined, options)
  } catch {
    return n.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  }
}
