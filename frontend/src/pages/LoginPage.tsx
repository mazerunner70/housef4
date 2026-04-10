import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import {
  cognitoConfirmForgotPassword,
  cognitoForgotPassword,
} from '@/auth/cognitoSession'
import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'

/** Matches `infrastructure/cognito.tf` password_policy (no symbol required). */
function passwordMeetsPoolPolicy(pw: string): boolean {
  if (pw.length < 8) return false
  if (!/[a-z]/.test(pw)) return false
  if (!/[A-Z]/.test(pw)) return false
  if (!/[0-9]/.test(pw)) return false
  return true
}

type LoginMode = 'signin' | 'forgot-send' | 'forgot-confirm'

export function LoginPage() {
  const { ready, cognitoEnabled, isAuthenticated, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from =
    (location.state as { from?: { pathname?: string } } | undefined)?.from
      ?.pathname ?? '/'

  const [mode, setMode] = useState<LoginMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  if (!cognitoEnabled) {
    return (
      <div className="dashboard-ambient flex min-h-svh items-center justify-center px-4 py-12">
        <Card className="max-w-md" title="Sign in">
          <p className="text-sm text-zinc-400">
            Cognito is not configured (missing{' '}
            <code className="text-zinc-300">VITE_COGNITO_*</code> build vars).
            Use local Vite dev with the API proxy, or deploy with Cognito env set.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-6 w-full"
            onClick={() => navigate('/')}
          >
            Back to app
          </Button>
        </Card>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="dashboard-ambient flex min-h-svh items-center justify-center text-zinc-400">
        <Spinner className="size-8 text-teal-400" />
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to={from === '/login' ? '/' : from} replace />
  }

  async function onSubmitSignIn(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setSubmitting(true)
    try {
      await login(email, password)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Sign in failed. Try again.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  async function onSendResetCode(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setSubmitting(true)
    try {
      await cognitoForgotPassword(email)
      setInfo('If the account exists, a verification code was sent to your email.')
      setMode('forgot-confirm')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not start password reset.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  async function onConfirmReset(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    if (newPassword !== newPassword2) {
      setError('New passwords do not match.')
      return
    }
    if (!passwordMeetsPoolPolicy(newPassword)) {
      setError(
        'Password must be at least 8 characters with upper, lower, and a number.',
      )
      return
    }
    setSubmitting(true)
    try {
      await cognitoConfirmForgotPassword(email, resetCode, newPassword)
      setPassword(newPassword)
      setMode('signin')
      setResetCode('')
      setNewPassword('')
      setNewPassword2('')
      setInfo('Password updated. You can sign in now.')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not reset password.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  function goSignIn() {
    setMode('signin')
    setError(null)
    setInfo(null)
    setResetCode('')
    setNewPassword('')
    setNewPassword2('')
  }

  return (
    <div className="dashboard-ambient flex min-h-svh items-center justify-center px-4 py-12">
      <Card
        className="w-full max-w-md"
        title={
          mode === 'signin'
            ? 'Sign in'
            : mode === 'forgot-send'
              ? 'Reset password'
              : 'Enter verification code'
        }
        description={
          mode === 'signin'
            ? 'Use your Cognito account for this environment.'
            : mode === 'forgot-send'
              ? 'We will email a code to this address if the account exists.'
              : 'Use the code from your email and choose a new password.'
        }
      >
        {mode === 'signin' ? (
          <form onSubmit={onSubmitSignIn} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="login-email"
                className="mb-1.5 block text-xs font-medium text-zinc-500"
              >
                Email
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="ui-surface-input w-full rounded-xl px-3 py-2.5 text-sm text-zinc-100 outline-none ring-teal-500/25 focus:ring-2"
              />
            </div>
            <div>
              <label
                htmlFor="login-password"
                className="mb-1.5 block text-xs font-medium text-zinc-500"
              >
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="ui-surface-input w-full rounded-xl px-3 py-2.5 text-sm text-zinc-100 outline-none ring-teal-500/25 focus:ring-2"
              />
            </div>
            <button
              type="button"
              className="self-start text-xs text-teal-400/90 hover:text-teal-300"
              onClick={() => {
                setMode('forgot-send')
                setError(null)
                setInfo(null)
              }}
            >
              Forgot password?
            </button>
            {error ? (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            ) : null}
            {info ? (
              <p className="text-sm text-teal-300/90" role="status">
                {info}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        )}
        {mode === 'forgot-send' ? (
          <form onSubmit={onSendResetCode} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="reset-email"
                className="mb-1.5 block text-xs font-medium text-zinc-500"
              >
                Email
              </label>
              <input
                id="reset-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="ui-surface-input w-full rounded-xl px-3 py-2.5 text-sm text-zinc-100 outline-none ring-teal-500/25 focus:ring-2"
              />
            </div>
            {error ? (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send verification code'}
            </Button>
            <button
              type="button"
              className="self-start text-xs text-zinc-500 hover:text-zinc-300"
              onClick={goSignIn}
            >
              Back to sign in
            </button>
          </form>
        ) : null}
        {mode === 'forgot-confirm' ? (
          <form onSubmit={onConfirmReset} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="reset-email-readonly"
                className="mb-1.5 block text-xs font-medium text-zinc-500"
              >
                Email
              </label>
              <input
                id="reset-email-readonly"
                type="email"
                readOnly
                value={email}
                className="ui-surface-input w-full cursor-not-allowed rounded-xl px-3 py-2.5 text-sm text-zinc-400 outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="reset-code"
                className="mb-1.5 block text-xs font-medium text-zinc-500"
              >
                Verification code
              </label>
              <input
                id="reset-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                required
                className="ui-surface-input w-full rounded-xl px-3 py-2.5 text-sm text-zinc-100 outline-none ring-teal-500/25 focus:ring-2"
              />
            </div>
            <div>
              <label
                htmlFor="new-password"
                className="mb-1.5 block text-xs font-medium text-zinc-500"
              >
                New password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="ui-surface-input w-full rounded-xl px-3 py-2.5 text-sm text-zinc-100 outline-none ring-teal-500/25 focus:ring-2"
              />
            </div>
            <div>
              <label
                htmlFor="new-password2"
                className="mb-1.5 block text-xs font-medium text-zinc-500"
              >
                Confirm new password
              </label>
              <input
                id="new-password2"
                type="password"
                autoComplete="new-password"
                value={newPassword2}
                onChange={(e) => setNewPassword2(e.target.value)}
                required
                className="ui-surface-input w-full rounded-xl px-3 py-2.5 text-sm text-zinc-100 outline-none ring-teal-500/25 focus:ring-2"
              />
            </div>
            {error ? (
              <p className="text-sm text-red-400" role="alert">
                {error}
              </p>
            ) : null}
            {info ? (
              <p className="text-sm text-teal-300/90" role="status">
                {info}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Saving…' : 'Set new password'}
            </Button>
            <button
              type="button"
              className="self-start text-xs text-zinc-500 hover:text-zinc-300"
              onClick={() => {
                setMode('forgot-send')
                setError(null)
              }}
            >
              Resend code
            </button>
            <button
              type="button"
              className="self-start text-xs text-zinc-500 hover:text-zinc-300"
              onClick={goSignIn}
            >
              Back to sign in
            </button>
          </form>
        ) : null}
      </Card>
    </div>
  )
}
