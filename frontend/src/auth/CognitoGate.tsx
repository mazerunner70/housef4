import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { Spinner } from '@/components/ui/Spinner'

import { useAuth } from './useAuth'

/**
 * `VITE_AUTH_UI=local` (default in Vite dev): no login.
 * `VITE_AUTH_UI=cognito` + Cognito build vars (prod deploy): require a session.
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
