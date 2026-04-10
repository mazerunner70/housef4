import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js'

import { getCognitoConfig } from './cognitoConfig'

let pool: CognitoUserPool | null = null

function getPool(): CognitoUserPool | null {
  const cfg = getCognitoConfig()
  if (!cfg) return null
  if (!pool) {
    pool = new CognitoUserPool({
      UserPoolId: cfg.userPoolId,
      ClientId: cfg.clientId,
    })
  }
  return pool
}

export async function cognitoSignIn(
  email: string,
  password: string,
): Promise<void> {
  const p = getPool()
  if (!p) throw new Error('Cognito is not configured')

  const username = email.trim()
  const authDetails = new AuthenticationDetails({
    Username: username,
    Password: password,
  })
  const cognitoUser = new CognitoUser({
    Username: username,
    Pool: p,
  })

  await new Promise<void>((resolve, reject) => {
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: () => resolve(),
      onFailure: (err) =>
        reject(err instanceof Error ? err : new Error(String(err))),
      newPasswordRequired: () => {
        reject(
          new Error(
            'Password change required — complete the flow in Cognito or use a fresh user.',
          ),
        )
      },
    })
  })
}

export function cognitoSignOut(): void {
  const p = getPool()
  try {
    p?.getCurrentUser()?.signOut()
  } catch {
    /* ignore */
  }
}

/** Sends a verification code to the user's verified email (pool must allow self-service reset). */
export async function cognitoForgotPassword(email: string): Promise<void> {
  const p = getPool()
  if (!p) throw new Error('Cognito is not configured')
  const cognitoUser = new CognitoUser({
    Username: email.trim(),
    Pool: p,
  })
  await new Promise<void>((resolve, reject) => {
    cognitoUser.forgotPassword({
      onSuccess: () => resolve(),
      onFailure: (err) =>
        reject(err instanceof Error ? err : new Error(String(err))),
    })
  })
}

export async function cognitoConfirmForgotPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  const p = getPool()
  if (!p) throw new Error('Cognito is not configured')
  const cognitoUser = new CognitoUser({
    Username: email.trim(),
    Pool: p,
  })
  await new Promise<void>((resolve, reject) => {
    cognitoUser.confirmPassword(code.trim(), newPassword, {
      onSuccess: () => resolve(),
      onFailure: (err) =>
        reject(err instanceof Error ? err : new Error(String(err))),
    })
  })
}

/**
 * Returns a valid Cognito **Id** JWT for API Gateway (audience matches app client).
 * `getSession` refreshes tokens when the refresh token is still valid.
 */
export async function getIdTokenJwt(): Promise<string | undefined> {
  const p = getPool()
  if (!p) return undefined

  const user = p.getCurrentUser()
  return new Promise((resolve) => {
    if (user == null) {
      resolve(undefined)
      return
    }
    user.getSession(
      (err: Error | undefined, session: CognitoUserSession | null) => {
        if (err || !session?.isValid()) {
          resolve(undefined)
          return
        }
        resolve(session.getIdToken().getJwtToken())
      },
    )
  })
}
