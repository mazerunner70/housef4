/**
 * ## Where “local vs Cognito” is decided
 *
 * **Do not read `import.meta.env.DEV`, `import.meta.env.PROD`, or `VITE_AUTH_UI`
 * outside this module.** That duplication is how wrong-env bugs slip in.
 *
 * ### Rules
 *
 * 1. **`vite build` with `mode === 'production'`** (the normal deploy path): the app
 *    **always** behaves as Cognito-required. A build with `VITE_AUTH_UI=local` is rejected
 *    at startup with a thrown error.
 *
 * 2. **`vite` dev server** (`mode === 'development'` by default): implicit default is
 *    **local** (no Cognito). Set **`VITE_AUTH_UI=cognito`** to exercise Cognito locally.
 *
 * 3. **Other Vite modes** (e.g. `vite build --mode staging`): implicit default is **Cognito**
 *    unless you pass `VITE_AUTH_UI=local` explicitly (use sparingly).
 *
 * 4. **`VITE_AUTH_UI`** must be **`local`**, **`cognito`**, or **unset**. Any other value throws.
 */

export type AppAuthMode = 'local' | 'cognito'

let cachedAuthMode: AppAuthMode | undefined

function readViteAuthUiExplicit(): 'local' | 'cognito' | undefined {
  const raw = import.meta.env.VITE_AUTH_UI?.trim()
  if (!raw) return undefined
  const lower = raw.toLowerCase()
  if (lower === 'local') return 'local'
  if (lower === 'cognito') return 'cognito'
  throw new Error(
    `[housef4] Invalid VITE_AUTH_UI=${JSON.stringify(raw)} — use "local", "cognito", or omit (see src/lib/appEnvironment.ts).`,
  )
}

/**
 * How the SPA wires authentication: **local** skips Cognito; **cognito** uses the pool.
 * Call this (or read `appAuthMode` from `useAuth`) instead of inventing your own checks.
 */
export function getAppAuthMode(): AppAuthMode {
  if (cachedAuthMode !== undefined) return cachedAuthMode

  const explicit = readViteAuthUiExplicit()
  const mode = import.meta.env.MODE
  const isProductionViteMode = mode === 'production'

  if (isProductionViteMode) {
    if (explicit === 'local') {
      throw new Error(
        '[housef4] Refusing to run: this bundle was built with Vite mode "production" and VITE_AUTH_UI=local. Production must use Cognito; fix the build env and rebuild.',
      )
    }
    cachedAuthMode = 'cognito'
    return cachedAuthMode
  }

  if (explicit === 'local') {
    cachedAuthMode = 'local'
    return cachedAuthMode
  }
  if (explicit === 'cognito') {
    cachedAuthMode = 'cognito'
    return cachedAuthMode
  }

  cachedAuthMode = mode === 'development' ? 'local' : 'cognito'
  return cachedAuthMode
}

/** Shown in the shell for local auth; align with backend `DEV_AUTH_USER_ID`. */
export function getLocalUserId(): string | undefined {
  const id = import.meta.env.VITE_LOCAL_USER_ID?.trim()
  return id && id.length > 0 ? id : undefined
}
