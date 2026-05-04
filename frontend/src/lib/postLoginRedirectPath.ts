function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object'
}

/**
 * Parses `history.state` from `<Navigate ... state={{ from: location }} />` without type assertions.
 * Returns a same-origin SPA path or `/`.
 */
export function postLoginRedirectPath(state: unknown): string {
  if (!isRecord(state) || !('from' in state)) return '/'
  const from = state.from
  if (!isRecord(from) || !('pathname' in from)) return '/'
  const pathname = from.pathname
  if (typeof pathname !== 'string' || pathname === '') return '/'
  /* Reject protocol-relative or non-app paths mistakenly stored in history */
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return '/'
  return pathname
}
