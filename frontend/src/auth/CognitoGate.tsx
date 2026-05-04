import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { Spinner } from '@/components/ui/Spinner'

import { useAuth } from './useAuth'

/**
 * When `getAppAuthMode()` is `local`, the gate is a no-op. Otherwise a Cognito session is required.
 */
export function CognitoGate() {
  const { ready, appAuthMode, isAuthenticated } = useAuth()
  const location = useLocation()

  if (appAuthMode === 'local') {
    return <Outlet />
  }

  if (!ready) {
    return (
      <div className="dashboard-ambient flex min-h-svh items-center justify-center text-zinc-400">
        <Spinner className="size-8 text-teal-400" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
