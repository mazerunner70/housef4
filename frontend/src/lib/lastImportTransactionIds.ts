const STORAGE_KEY = 'housef4-last-import-transaction-ids'

/** Clears any previous list, then stores ids when non-empty (avoids stale ids across imports). */
export function syncLastImportTransactionIds(ids: string[] | undefined): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
  if (!ids?.length) return
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // quota / private mode
  }
}

export function clearLastImportTransactionIds(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function readLastImportTransactionIds(): string[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}
