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
