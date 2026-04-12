import { createContext } from 'react'

import type { AuthUiMode } from './authUiMode'

export type AuthContextValue = {
  /** `local` = no Cognito UI; `cognito` = prod-style login. */
  authUiMode: AuthUiMode
  /** Local-only label from `VITE_LOCAL_USER_ID` (align with backend `DEV_AUTH_USER_ID`). */
  localUserId: string | undefined
  ready: boolean
  /** True when Cognito login gate is active (prod deploys). */
  cognitoEnabled: boolean
  isAuthenticated: boolean
  userEmail: string | undefined
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
