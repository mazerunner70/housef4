import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { Spinner } from '@/components/ui/Spinner'

import { useAuth } from './useAuth'

/**
 * When Cognito env is present (deployed builds), require a session for app routes.
 * Local dev without `VITE_COGNITO_*` skips the gate.
 */
export function CognitoGate() {
  const { ready, cognitoEnabled, isAuthenticated } = useAuth()
  const location = useLocation()

  if (!cognitoEnabled) {
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
