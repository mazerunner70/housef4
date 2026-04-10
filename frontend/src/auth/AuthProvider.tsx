import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { setBearerTokenResolver } from '@/api/client'

import { AuthContext } from './auth-context'
import { cognitoSignIn, cognitoSignOut, getIdTokenJwt } from './cognitoSession'
import { isCognitoConfigured } from './cognitoConfig'
import { emailFromIdToken } from './jwtPayload'

export function AuthProvider({ children }: { children: ReactNode }) {
  const cognitoEnabled = isCognitoConfigured()
  const [ready, setReady] = useState(!cognitoEnabled)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!cognitoEnabled) {
      setBearerTokenResolver(undefined)
      return
    }

    setBearerTokenResolver(getIdTokenJwt)

    let cancelled = false
    ;(async () => {
      const token = await getIdTokenJwt()
      if (cancelled) return
      if (token) {
        setIsAuthenticated(true)
        setUserEmail(emailFromIdToken(token))
      } else {
        setIsAuthenticated(false)
        setUserEmail(undefined)
      }
      setReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [cognitoEnabled])

  const login = useCallback(async (email: string, password: string) => {
    await cognitoSignIn(email, password)
    const token = await getIdTokenJwt()
    setIsAuthenticated(!!token)
    setUserEmail(token ? emailFromIdToken(token) ?? email.trim() : undefined)
  }, [])

  const logout = useCallback(() => {
    cognitoSignOut()
    setIsAuthenticated(false)
    setUserEmail(undefined)
  }, [])

  const value = useMemo(
    () => ({
      ready,
      cognitoEnabled,
      isAuthenticated,
      userEmail,
      login,
      logout,
    }),
    [ready, cognitoEnabled, isAuthenticated, userEmail, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
