function base64UrlToBinary(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
  return atob(base64 + pad)
}

/** Decode Cognito IdToken payload (presentation only — not verified). */
export function decodeJwtPayload(
  jwt: string,
): Record<string, unknown> | null {
  try {
    const part = jwt.split('.')[1]
    if (!part) return null
    const json = base64UrlToBinary(part)
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

export function emailFromIdToken(idToken: string): string | undefined {
  const payload = decodeJwtPayload(idToken)
  const email = payload?.email
  return typeof email === 'string' && email.length > 0 ? email : undefined
}
