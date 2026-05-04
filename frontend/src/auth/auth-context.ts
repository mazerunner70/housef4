import { createContext } from 'react'

import type { AppAuthMode } from '@/lib/appEnvironment'

export type AuthContextValue = {
  /** From `getAppAuthMode()` — single source for local vs Cognito wiring. */
  appAuthMode: AppAuthMode
  /** Local-only label from `VITE_LOCAL_USER_ID` (align with backend `DEV_AUTH_USER_ID`). */
  localUserId: string | undefined
  ready: boolean
  isAuthenticated: boolean
  userEmail: string | undefined
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
