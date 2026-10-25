import type { MeInfo } from '@/utils/api'
import { SECURITY_CONFIG } from '@/constants/security'
import { getSharedApi } from '@/utils/api'

export type AuthStatus = 'unknown' | 'guest' | 'authenticated' | 'error'
export type PermissionKey
  = | 'advancedTools'
    | 'snapshotExport'
    | 'healthSummary'
    | 'providerValue'
    | 'nodeTopology'
    | 'auditLog'
    | 'diskPrediction'
    | 'providerGeoLookup'

export interface AuthSession {
  status: AuthStatus
  authenticated: boolean
  user: MeInfo | null
  lastVerifiedAt: number
  errorMessage?: string
}

export interface VerifyLoginOptions {
  force?: boolean
}

export interface PermissionResult {
  granted: boolean
  session: AuthSession
  reason?: string
}

let authSession: AuthSession = {
  status: 'unknown',
  authenticated: false,
  user: null,
  lastVerifiedAt: 0,
}
let verifyPromise: Promise<AuthSession> | null = null
let sessionRevision = 0

export function getAuthSessionRevision(): number {
  return sessionRevision
}

function sessionIdentity(session: AuthSession): string {
  return JSON.stringify([session.authenticated, session.user?.uuid, session.user?.username, session.user?.sso_id])
}

function replaceSession(session: AuthSession, explicit = false): AuthSession {
  if (explicit || sessionIdentity(session) !== sessionIdentity(authSession))
    sessionRevision++
  authSession = session
  return authSession
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function createSessionFromMe(user: MeInfo): AuthSession {
  const authenticated = Boolean(user.logged_in)
  return {
    status: authenticated ? 'authenticated' : 'guest',
    authenticated,
    user: authenticated ? user : null,
    lastVerifiedAt: Date.now(),
  }
}

export function getAuthSession(): AuthSession {
  return authSession
}

export function isAuthenticated(): boolean {
  return authSession.authenticated
}

export function getCurrentUser(): MeInfo | null {
  return authSession.user
}

export function setAuthSessionFromLogin(loggedIn: boolean, user: MeInfo | null = null): AuthSession {
  return replaceSession({
    status: loggedIn ? 'authenticated' : 'guest',
    authenticated: loggedIn,
    user: loggedIn ? user : null,
    lastVerifiedAt: Date.now(),
  }, true)
}

export async function verifyLogin(options: VerifyLoginOptions = {}): Promise<AuthSession> {
  const now = Date.now()
  const freshEnough = now - authSession.lastVerifiedAt < SECURITY_CONFIG.auth.verifyTtl
  if (!options.force && authSession.status !== 'unknown' && freshEnough)
    return authSession

  if (verifyPromise)
    return verifyPromise

  const requestedRevision = sessionRevision
  verifyPromise = getSharedApi().getMe().then((user) => {
    if (requestedRevision !== sessionRevision)
      return authSession
    return replaceSession(createSessionFromMe(user))
  }).catch((error) => {
    if (requestedRevision !== sessionRevision)
      return authSession
    return replaceSession({
      status: 'error',
      authenticated: false,
      user: null,
      lastVerifiedAt: Date.now(),
      errorMessage: getErrorMessage(error),
    })
  }).finally(() => {
    verifyPromise = null
  })

  return verifyPromise
}

export async function requirePermission(permission: PermissionKey, options: VerifyLoginOptions = { force: true }): Promise<PermissionResult> {
  const session = await verifyLogin(options)
  if (session.authenticated) {
    return {
      granted: true,
      session,
    }
  }

  return {
    granted: false,
    session,
    reason: `${permission} requires a verified login session`,
  }
}
