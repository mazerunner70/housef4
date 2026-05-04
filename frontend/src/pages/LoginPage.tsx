import { useState, type ComponentProps } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import {
  cognitoConfirmForgotPassword,
  cognitoForgotPassword,
} from '@/auth/cognitoSession'
import { useAuth } from '@/auth/useAuth'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'
import { postLoginRedirectPath } from '@/lib/postLoginRedirectPath'

type FormSubmit = NonNullable<ComponentProps<'form'>['onSubmit']>

/** Matches `infrastructure/cognito.tf` password_policy (no symbol required). */
function passwordMeetsPoolPolicy(pw: string): boolean {
  if (pw.length < 8) return false
  if (!/[a-z]/.test(pw)) return false
  if (!/[A-Z]/.test(pw)) return false
  if (!/\d/.test(pw)) return false
  return true
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

type LoginMode = 'signin' | 'forgot-send' | 'forgot-confirm'

const LOGIN_CARD_META: Record<LoginMode, { title: string; description: string }> =
  {
    signin: {
      title: 'Sign in',
      description: 'Use your Cognito account for this environment.',
    },
    'forgot-send': {
      title: 'Reset password',
      description:
        'We will email a code to this address if the account exists.',
    },
    'forgot-confirm': {
      title: 'Enter verification code',
      description: 'Use the code from your email and choose a new password.',
    },
  }

function FormFeedback({
  error,
  info,
}: Readonly<{ error: string | null; info: string | null }>) {
  return (
    <>
      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {info ? (
        <output
          className="block text-sm text-teal-300/90"
          aria-live="polite"
        >
          {info}
        </output>
      ) : null}
    </>
  )
}

type SignInFormProps = Readonly<{
  email: string
  password: string
  error: string | null
  info: string | null
  submitting: boolean
  onEmailChange: (v: string) => void
  onPasswordChange: (v: string) => void
  onForgotPassword: () => void
  onSubmit: FormSubmit
}>

function SignInForm({
  email,
  password,
  error,
  info,
  submitting,
  onEmailChange,
  onPasswordChange,
  onForgotPassword,
  onSubmit,
}: SignInFormProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
          onChange={(e) => onEmailChange(e.target.value)}
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
          onChange={(e) => onPasswordChange(e.target.value)}
          required
          className="ui-surface-input w-full rounded-xl px-3 py-2.5 text-sm text-zinc-100 outline-none ring-teal-500/25 focus:ring-2"
        />
      </div>
      <button
        type="button"
        className="self-start text-xs text-teal-400/90 hover:text-teal-300"
        onClick={onForgotPassword}
      >
        Forgot password?
      </button>
      <FormFeedback error={error} info={info} />
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}

type ForgotSendFormProps = Readonly<{
  email: string
  error: string | null
  submitting: boolean
  onEmailChange: (v: string) => void
  goSignIn: () => void
  onSubmit: FormSubmit
}>

function ForgotSendForm({
  email,
  error,
  submitting,
  onEmailChange,
  goSignIn,
  onSubmit,
}: ForgotSendFormProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
          onChange={(e) => onEmailChange(e.target.value)}
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
  )
}

type ForgotConfirmFormProps = Readonly<{
  email: string
  resetCode: string
  newPassword: string
  newPassword2: string
  error: string | null
  info: string | null
  submitting: boolean
  onResetCodeChange: (v: string) => void
  onNewPasswordChange: (v: string) => void
  onNewPassword2Change: (v: string) => void
  goResend: () => void
  goSignIn: () => void
  onSubmit: FormSubmit
}>

function ForgotConfirmForm({
  email,
  resetCode,
  newPassword,
  newPassword2,
  error,
  info,
  submitting,
  onResetCodeChange,
  onNewPasswordChange,
  onNewPassword2Change,
  goResend,
  goSignIn,
  onSubmit,
}: ForgotConfirmFormProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
          onChange={(e) => onResetCodeChange(e.target.value)}
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
          onChange={(e) => onNewPasswordChange(e.target.value)}
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
          onChange={(e) => onNewPassword2Change(e.target.value)}
          required
          className="ui-surface-input w-full rounded-xl px-3 py-2.5 text-sm text-zinc-100 outline-none ring-teal-500/25 focus:ring-2"
        />
      </div>
      <FormFeedback error={error} info={info} />
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Saving…' : 'Set new password'}
      </Button>
      <button
        type="button"
        className="self-start text-xs text-zinc-500 hover:text-zinc-300"
        onClick={goResend}
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
  )
}

function LoginModePanel({
  mode,
  login,
  email,
  setEmail,
  password,
  setPassword,
  resetCode,
  setResetCode,
  newPassword,
  setNewPassword,
  newPassword2,
  setNewPassword2,
  error,
  setError,
  info,
  setInfo,
  submitting,
  setSubmitting,
  setMode,
  goSignIn,
}: Readonly<{
  mode: LoginMode
  login: (email: string, password: string) => Promise<void>
  email: string
  setEmail: (v: string) => void
  password: string
  setPassword: (v: string) => void
  resetCode: string
  setResetCode: (v: string) => void
  newPassword: string
  setNewPassword: (v: string) => void
  newPassword2: string
  setNewPassword2: (v: string) => void
  error: string | null
  setError: (v: string | null) => void
  info: string | null
  setInfo: (v: string | null) => void
  submitting: boolean
  setSubmitting: (v: boolean) => void
  setMode: (m: LoginMode) => void
  goSignIn: () => void
}>) {
  const clearFeedback = (): void => {
    setError(null)
    setInfo(null)
  }

  async function runSignInSubmit(): Promise<void> {
    clearFeedback()
    setSubmitting(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(errMessage(err, 'Sign in failed. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  const onSubmitSignIn: FormSubmit = (e) => {
    e.preventDefault()
    void runSignInSubmit()
  }

  async function runSendResetCodeSubmit(): Promise<void> {
    clearFeedback()
    setSubmitting(true)
    try {
      await cognitoForgotPassword(email)
      setInfo('If the account exists, a verification code was sent to your email.')
      setMode('forgot-confirm')
    } catch (err) {
      setError(errMessage(err, 'Could not start password reset.'))
    } finally {
      setSubmitting(false)
    }
  }

  const onSendResetCode: FormSubmit = (e) => {
    e.preventDefault()
    void runSendResetCodeSubmit()
  }

  async function runConfirmResetSubmit(): Promise<void> {
    clearFeedback()
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
      setError(errMessage(err, 'Could not reset password.'))
    } finally {
      setSubmitting(false)
    }
  }

  const onConfirmReset: FormSubmit = (e) => {
    e.preventDefault()
    void runConfirmResetSubmit()
  }

  switch (mode) {
    case 'signin':
      return (
        <SignInForm
          email={email}
          password={password}
          error={error}
          info={info}
          submitting={submitting}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onForgotPassword={() => {
            setMode('forgot-send')
            clearFeedback()
          }}
          onSubmit={onSubmitSignIn}
        />
      )
    case 'forgot-send':
      return (
        <ForgotSendForm
          email={email}
          error={error}
          submitting={submitting}
          onEmailChange={setEmail}
          goSignIn={goSignIn}
          onSubmit={onSendResetCode}
        />
      )
    case 'forgot-confirm':
      return (
        <ForgotConfirmForm
          email={email}
          resetCode={resetCode}
          newPassword={newPassword}
          newPassword2={newPassword2}
          error={error}
          info={info}
          submitting={submitting}
          onResetCodeChange={setResetCode}
          onNewPasswordChange={setNewPassword}
          onNewPassword2Change={setNewPassword2}
          goResend={() => {
            setMode('forgot-send')
            setError(null)
          }}
          goSignIn={goSignIn}
          onSubmit={onConfirmReset}
        />
      )
  }
}

export function LoginPage() {
  const { appAuthMode, ready, isAuthenticated, login } = useAuth()
  const location = useLocation()
  const from = postLoginRedirectPath(location.state)

  const [mode, setMode] = useState<LoginMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  function goSignIn(): void {
    setMode('signin')
    setError(null)
    setInfo(null)
    setResetCode('')
    setNewPassword('')
    setNewPassword2('')
  }

  if (appAuthMode === 'local') {
    return <Navigate to="/" replace />
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

  const meta = LOGIN_CARD_META[mode]

  return (
    <div className="dashboard-ambient flex min-h-svh items-center justify-center px-4 py-12">
      <Card
        className="w-full max-w-md"
        title={meta.title}
        description={meta.description}
      >
        <LoginModePanel
          mode={mode}
          login={login}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          resetCode={resetCode}
          setResetCode={setResetCode}
          newPassword={newPassword}
          setNewPassword={setNewPassword}
          newPassword2={newPassword2}
          setNewPassword2={setNewPassword2}
          error={error}
          setError={setError}
          info={info}
          setInfo={setInfo}
          submitting={submitting}
          setSubmitting={setSubmitting}
          setMode={setMode}
          goSignIn={goSignIn}
        />
      </Card>
    </div>
  )
}
