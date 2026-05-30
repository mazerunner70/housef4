/** Normalize ISO 4217 for import / profile currency fields. */
export function normalizeIso4217Currency(code?: string): string | undefined {
  const normalized = code?.trim().toUpperCase();
  if (normalized && /^[A-Z]{3}$/.test(normalized)) return normalized;
  return undefined;
}
