/**
 * Strip optional API Gateway stage prefix so `/Prod/api/health` matches `/api/health`.
 */
export function normalizeApiPath(path: string): string {
  const pathname = path.split('?')[0] ?? '';
  const idx = pathname.indexOf('/api/');
  if (idx >= 0) return pathname.slice(idx);
  return pathname;
}
