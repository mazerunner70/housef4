import { createContext } from 'react'

export type AuthContextValue = {
  ready: boolean
  cognitoEnabled: boolean
  isAuthenticated: boolean
  userEmail: string | undefined
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
