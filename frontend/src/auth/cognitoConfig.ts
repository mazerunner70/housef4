export type CognitoPublicConfig = {
  region: string
  userPoolId: string
  clientId: string
}

/**
 * Vite injects these at build time for CloudFront deploys. Omit for local dev
 * (Vite proxy + optional `DEV_AUTH_USER_ID` on the API).
 */
export function getCognitoConfig(): CognitoPublicConfig | null {
  const region = import.meta.env.VITE_COGNITO_REGION?.trim()
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID?.trim()
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID?.trim()
  if (!region || !userPoolId || !clientId) return null
  return { region, userPoolId, clientId }
}
