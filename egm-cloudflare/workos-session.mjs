import { verifyWorkosPermission } from './workos-rbac.mjs'
import { refreshWorkosSession } from './workos-refresh.mjs'
import { verifyWorkosSessionToken, workosSessionState } from './workos-widgets.mjs'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const un64 = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))

async function encryptionKey(secret) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('egm-workos-session-v1'), info: encoder.encode('tokens') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

async function encrypt(secret, sessionId, userId, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${sessionId}:${userId}`) }, await encryptionKey(secret), encoder.encode(JSON.stringify(payload)))
  return `${b64(iv)}.${b64(new Uint8Array(ciphertext))}`
}

// SESSION_SECRET rotation: set the new value as SESSION_SECRET and the old one
// as SESSION_SECRET_PREVIOUS. Everything is written with the current secret and
// read with either; remove the previous secret once sessions have expired.
export const sessionSecrets = env => [env.SESSION_SECRET, env.SESSION_SECRET_PREVIOUS].filter((value, index) => typeof value === 'string' && value.length >= 48 && (index === 0 || value !== env.SESSION_SECRET))

async function decrypt(secrets, sessionId, userId, value) {
  const [iv, ciphertext, ...rest] = value.split('.')
  if (rest.length || !iv || !ciphertext) throw Error('invalid_ciphertext')
  let plaintext
  for (const secret of [].concat(secrets)) {
    try { plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(iv), additionalData: encoder.encode(`${sessionId}:${userId}`) }, await encryptionKey(secret), un64(ciphertext)); break } catch {}
  }
  if (!plaintext) throw Error('invalid_ciphertext')
  const result = JSON.parse(decoder.decode(plaintext))
  if (typeof result.accessToken !== 'string' || typeof result.refreshToken !== 'string' || !result.accessToken || !result.refreshToken) throw Error('invalid_tokens')
  return result
}

// This unverified value can only suppress a refresh and deny access. It is
// never used to grant a permission; only verifyWorkosPermission can do that.
function unverifiedExpiry(token) {
  try { return JSON.parse(decoder.decode(un64(token.split('.')[1]))).exp * 1000 } catch { return 0 }
}

export function rbacConfigured(env) {
  return env.WORKOS_RBAC_ENABLED === 'true' && /^org_[A-Za-z0-9]+$/.test(env.WORKOS_RBAC_ORGANIZATION_ID ?? '') && /^client_[A-Za-z0-9]+$/.test(env.WORKOS_CLIENT_ID ?? '') && typeof env.WORKOS_API_KEY === 'string' && !!env.WORKOS_API_KEY && typeof env.WORKOS_RBAC_ISSUER === 'string' && !!env.WORKOS_RBAC_ISSUER && typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 48
}

export function workosSessionConfigured(env) {
  return env.WORKOS_WIDGETS_ENABLED === 'true' && /^client_[A-Za-z0-9]+$/.test(env.WORKOS_CLIENT_ID ?? '') && /^user_[A-Za-z0-9]+$/.test(env.WORKOS_OWNER_USER_ID ?? '') && typeof env.WORKOS_API_KEY === 'string' && !!env.WORKOS_API_KEY && typeof env.WORKOS_RBAC_ISSUER === 'string' && !!env.WORKOS_RBAC_ISSUER && typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 48
}

export async function storeWorkosSession(env, sessionId, userId, accessToken, refreshToken) {
  if (!(rbacConfigured(env) || workosSessionConfigured(env)) || typeof accessToken !== 'string' || !accessToken || typeof refreshToken !== 'string' || !refreshToken) return false
  const tokens = await encrypt(env.SESSION_SECRET, sessionId, userId, { accessToken, refreshToken })
  await env.DB.prepare('INSERT INTO workos_sessions(session_id,user_id,tokens,scoped) VALUES(?,?,?,0)').bind(sessionId, userId, tokens).run()
  return true
}

// Bind the WorkOS session to the authenticated D1 user. Only a signed token
// may supply its session id; a full active-session lookup establishes that it
// has not been revoked. Network failures fail closed without erasing D1 state.
export async function validatedWorkosSession(env, sessionId, userId, options = {}) {
  if (!workosSessionConfigured(env)) return { status: 'unavailable' }
  const clock = options.now ?? Date.now, request = options.request ?? fetch
  const row = await env.DB.prepare('SELECT * FROM workos_sessions WHERE session_id=? AND user_id=?').bind(sessionId, userId).first()
  if (!row) return { status: 'reauthenticate' }
  let tokens
  try { tokens = await decrypt(sessionSecrets(env), sessionId, userId, row.tokens) } catch { return { status: 'reauthenticate' } }
  const verifySession = token => verifyWorkosSessionToken(token, { clientId: env.WORKOS_CLIENT_ID, issuer: env.WORKOS_RBAC_ISSUER, userId, request, now: clock(), allowExpiredForBinding: true })
  // An expired signed token remains useful solely to bind a rotation to the
  // same provider session. It never grants access on its own.
  const original = await verifySession(tokens.accessToken)
  if (!original) return { status: 'unavailable' }
  if (unverifiedExpiry(tokens.accessToken) <= clock()) {
    const lease = crypto.randomUUID(), time = clock()
    const acquired = await env.DB.prepare('UPDATE workos_sessions SET lease_id=?,lease_until=? WHERE session_id=? AND user_id=? AND version=? AND lease_until<=?').bind(lease, time + 15000, sessionId, userId, row.version, time).run()
    if (acquired.meta?.changes !== 1) return { status: 'unavailable' }
    try {
      const orgId = row.scoped ? env.WORKOS_RBAC_ORGANIZATION_ID : undefined
      if (row.scoped && !/^org_[A-Za-z0-9]+$/.test(orgId ?? '')) return { status: 'unavailable' }
      const refreshed = await refreshWorkosSession({ clientId: env.WORKOS_CLIENT_ID, clientSecret: env.WORKOS_API_KEY, organizationId: orgId, refreshToken: tokens.refreshToken, request })
      if (refreshed.status !== 'refreshed') return { status: refreshed.status === 'revoked' ? 'revoked' : 'unavailable' }
      if (refreshed.userId !== userId) return { status: 'unavailable' }
      const next = await verifyWorkosSessionToken(refreshed.accessToken, { clientId: env.WORKOS_CLIENT_ID, issuer: env.WORKOS_RBAC_ISSUER, userId, request, now: clock() })
      if (!next || next.sessionId !== original.sessionId) return { status: 'unavailable' }
      tokens = { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken }
      const rotated = await encrypt(env.SESSION_SECRET, sessionId, userId, tokens)
      const saved = await env.DB.prepare('UPDATE workos_sessions SET tokens=?,version=version+1,lease_id=NULL,lease_until=0 WHERE session_id=? AND user_id=? AND version=? AND lease_id=?').bind(rotated, sessionId, userId, row.version, lease).run()
      if (saved.meta?.changes !== 1) return { status: 'unavailable' }
    } finally {
      await env.DB.prepare('UPDATE workos_sessions SET lease_id=NULL,lease_until=0 WHERE session_id=? AND user_id=? AND lease_id=?').bind(sessionId, userId, lease).run()
    }
  }
  const verified = await verifyWorkosSessionToken(tokens.accessToken, { clientId: env.WORKOS_CLIENT_ID, issuer: env.WORKOS_RBAC_ISSUER, userId, request, now: clock() })
  if (!verified || verified.sessionId !== original.sessionId) return { status: 'unavailable' }
  const state = await workosSessionState({ apiKey: env.WORKOS_API_KEY, userId, sessionId: verified.sessionId, request, now: clock() })
  return state === 'active' ? { status: 'active', accessToken: tokens.accessToken, workosSessionId: verified.sessionId } : { status: state === 'inactive' ? 'revoked' : 'unavailable' }
}

// Legacy opaque sessions retain access to approved dashboard content but do not
// receive administrative permissions after RBAC is enabled; sign-in renews them.
// No permission is granted without checking a signed, unexpired, org-bound JWT.
export async function workosAdminPermission(env, sessionId, userId, options = {}) {
  if (!rbacConfigured(env)) return { status: 'unavailable' }
  const clock = options.now ?? Date.now
  const request = options.request ?? fetch
  const permission = env.WORKOS_RBAC_PERMISSION || 'egm:dashboard:admin'
  const expected = { clientId: env.WORKOS_CLIENT_ID, issuer: env.WORKOS_RBAC_ISSUER, subject: userId, organizationId: env.WORKOS_RBAC_ORGANIZATION_ID, permission, request, time: clock() }
  const select = () => env.DB.prepare('SELECT * FROM workos_sessions WHERE session_id=? AND user_id=?').bind(sessionId, userId).first()
  const row = await select()
  if (!row) return { status: 'reauthenticate' }
  let tokens
  try { tokens = await decrypt(sessionSecrets(env), sessionId, userId, row.tokens) } catch { return { status: 'reauthenticate' } }
  if (row.scoped && await verifyWorkosPermission(tokens.accessToken, expected)) return { status: 'allowed' }
  if (row.scoped && unverifiedExpiry(tokens.accessToken) > clock()) return { status: 'denied' }

  const lease = crypto.randomUUID(), now = clock()
  let previousSession
  if (env.WORKOS_WIDGETS_ENABLED === 'true') {
    previousSession = await verifyWorkosSessionToken(tokens.accessToken, { clientId: env.WORKOS_CLIENT_ID, issuer: env.WORKOS_RBAC_ISSUER, userId, request, now, allowExpiredForBinding: true })
    if (!previousSession) return { status: 'retryable' }
  }
  // Keep the lease shorter than WorkOS's 30-second rotation replay grace and
  // longer than its bounded refresh request. CAS prevents stale overwrites.
  const acquired = await env.DB.prepare('UPDATE workos_sessions SET lease_id=?,lease_until=? WHERE session_id=? AND user_id=? AND version=? AND lease_until<=?').bind(lease, now + 15000, sessionId, userId, row.version, now).run()
  if (acquired.meta?.changes !== 1) return { status: 'retryable' }
  try {
    const refreshed = await refreshWorkosSession({ clientId: env.WORKOS_CLIENT_ID, clientSecret: env.WORKOS_API_KEY, organizationId: env.WORKOS_RBAC_ORGANIZATION_ID, refreshToken: tokens.refreshToken, request })
    if (refreshed.status !== 'refreshed') return { status: refreshed.status === 'retryable' ? 'retryable' : 'denied' }
    if (refreshed.userId !== userId) return { status: 'denied' }
    if (previousSession) {
      const nextSession = await verifyWorkosSessionToken(refreshed.accessToken, { clientId: env.WORKOS_CLIENT_ID, issuer: env.WORKOS_RBAC_ISSUER, userId, request, now: clock() })
      if (!nextSession || nextSession.sessionId !== previousSession.sessionId) return { status: 'denied' }
    }
    const rotated = await encrypt(env.SESSION_SECRET, sessionId, userId, { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken })
    const saved = await env.DB.prepare('UPDATE workos_sessions SET tokens=?,scoped=1,version=version+1,lease_id=NULL,lease_until=0 WHERE session_id=? AND user_id=? AND version=? AND lease_id=?').bind(rotated, sessionId, userId, row.version, lease).run()
    if (saved.meta?.changes !== 1) return { status: 'retryable' }
    return { status: await verifyWorkosPermission(refreshed.accessToken, { ...expected, time: clock() }) ? 'allowed' : 'denied' }
  } finally {
    await env.DB.prepare('UPDATE workos_sessions SET lease_id=NULL,lease_until=0 WHERE session_id=? AND user_id=? AND lease_id=?').bind(sessionId, userId, lease).run()
  }
}

// Best-effort: end the provider session on sign-out so its refresh token stops
// working. The session ID comes from a verified token, never from the browser.
// https://workos.com/docs/reference/authkit/session/revoke
export async function revokeWorkosSession(env, sessionId, options = {}) {
  if (!(rbacConfigured(env) || workosSessionConfigured(env))) return false
  const request = options.request ?? fetch
  try {
    const row = await env.DB.prepare('SELECT user_id,tokens FROM workos_sessions WHERE session_id=?').bind(sessionId).first()
    if (!row) return false
    const tokens = await decrypt(sessionSecrets(env), sessionId, row.user_id, row.tokens)
    const verified = await verifyWorkosSessionToken(tokens.accessToken, { clientId: env.WORKOS_CLIENT_ID, issuer: env.WORKOS_RBAC_ISSUER, userId: row.user_id, request, now: (options.now ?? Date.now)(), allowExpiredForBinding: true })
    if (!verified) return false
    const response = await request('https://api.workos.com/user_management/sessions/revoke', { method: 'POST', headers: { authorization: `Bearer ${env.WORKOS_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ session_id: verified.sessionId }), redirect: 'manual', signal: AbortSignal.timeout(5000) })
    return response.ok
  } catch { return false }
}
