/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional Bearer token for API calls in deployed builds (prefer setApiAuthTokenGetter + Cognito at runtime). */
  readonly VITE_API_BEARER_TOKEN?: string
  /** `local` = no login UI; `cognito` = Cognito gate (deploy script sets this). */
  readonly VITE_AUTH_UI?: string
  /** Shown in the shell when `VITE_AUTH_UI=local`; match backend `DEV_AUTH_USER_ID`. */
  readonly VITE_LOCAL_USER_ID?: string
  /** Cognito region (e.g. eu-west-2); set for AWS deploys so the SPA can sign in and call `/api/*`. */
  readonly VITE_COGNITO_REGION?: string
  readonly VITE_COGNITO_USER_POOL_ID?: string
  readonly VITE_COGNITO_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
