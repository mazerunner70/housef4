/**
 * Strip optional API Gateway stage prefix so `/Prod/api/health` matches `/api/health`.
 * Always returns a pathname only: the query string (`?…`) is stripped; fragments are not
 * sent on HTTP request URLs in practice.
 */
export function normalizeApiPath(path: string): string {
  const pathname = path.split('?')[0] ?? '';
  const idx = pathname.indexOf('/api/');
  if (idx >= 0) return pathname.slice(idx);
  return pathname;
}
