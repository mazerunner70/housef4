/**
 * `local` — no Cognito login; identity label from `VITE_LOCAL_USER_ID` (match backend `DEV_AUTH_USER_ID`).
 * `cognito` — Cognito login (required for prod deploys).
 *
 * Defaults: Vite dev server → `local`. Production bundles → `cognito` unless overridden.
 */
export type AuthUiMode = 'local' | 'cognito'

export function getAuthUiMode(): AuthUiMode {
  const raw = import.meta.env.VITE_AUTH_UI?.trim().toLowerCase()
  if (raw === 'cognito') return 'cognito'
  if (raw === 'local') return 'local'
  return import.meta.env.DEV ? 'local' : 'cognito'
}

/** Display / API identity for local UI mode (sync with backend `DEV_AUTH_USER_ID`). */
export function getLocalUserId(): string | undefined {
  const id = import.meta.env.VITE_LOCAL_USER_ID?.trim()
  return id && id.length > 0 ? id : undefined
}
