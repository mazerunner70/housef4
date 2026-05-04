import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { setBearerTokenResolver } from '@/api/client'
import { getAppAuthMode, getLocalUserId } from '@/lib/appEnvironment'

import { AuthContext } from './auth-context'
import { cognitoSignIn, cognitoSignOut, getIdTokenJwt } from './cognitoSession'
import { emailFromIdToken } from './jwtPayload'

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const appAuthMode = getAppAuthMode()
  const localUserId = getLocalUserId()
  const isLocal = appAuthMode === 'local'

  const [ready, setReady] = useState(() => isLocal)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (isLocal) {
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
  }, [isLocal])

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
      appAuthMode,
      localUserId,
      ready,
      isAuthenticated,
      userEmail,
      login,
      logout,
    }),
    [
      appAuthMode,
      localUserId,
      ready,
      isAuthenticated,
      userEmail,
      login,
      logout,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
