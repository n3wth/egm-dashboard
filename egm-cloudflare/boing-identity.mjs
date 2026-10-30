import { verifyWorkosSessionToken, workosSessionState } from './workos-widgets.mjs'
import { readVerifiedWorkosEmail } from './workos-identity.mjs'

// Separate storage. This schema deliberately has no foreign key to legacy
// users and never writes users, sessions or workos_sessions.
export const BOING_IDENTITY_SCHEMA = `
CREATE TABLE IF NOT EXISTS boing_identities (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'suspended'))
);
CREATE TABLE IF NOT EXISTS boing_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES boing_identities(user_id),
  workos_session_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);`

const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const hash = async token => encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
const validToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
const validConfig = env => env?.DB?.prepare && /^client_[A-Za-z0-9]+$/.test(env.WORKOS_CLIENT_ID ?? '') && typeof env.WORKOS_RBAC_ISSUER === 'string' && !!env.WORKOS_RBAC_ISSUER && typeof env.WORKOS_API_KEY === 'string' && !!env.WORKOS_API_KEY

// Call only after a server-side WorkOS authorization-code exchange. The user
// ID is a selector; the signed access token binds it to a provider session.
// Creating a session alone does not grant tenant or project access.
export async function createBoingSession(env, userId, accessToken, { request = fetch, now = Date.now() } = {}) {
  if (!validConfig(env) || !/^user_[A-Za-z0-9]+$/.test(userId ?? '')) return { status: 'unavailable' }
  const verified = await verifyWorkosSessionToken(accessToken, { clientId: env.WORKOS_CLIENT_ID, issuer: env.WORKOS_RBAC_ISSUER, userId, request, now })
  if (!verified) return { status: 'denied' }
  const state = await workosSessionState({ apiKey: env.WORKOS_API_KEY, userId, sessionId: verified.sessionId, request, now })
  if (state !== 'active') return { status: state === 'inactive' ? 'denied' : 'unavailable' }
  const email = await readVerifiedWorkosEmail(env, userId, request)
  if (!email) return { status: 'unavailable' }
  try {
    const token = encode(crypto.getRandomValues(new Uint8Array(32)))
    const expiresAt = Math.floor(now / 1000) + 1800
    const tokenHash = await hash(token)
    const result = await env.DB.batch([
      env.DB.prepare("INSERT INTO boing_identities(user_id,email,status) VALUES(?,?,'active') ON CONFLICT(user_id) DO UPDATE SET email=excluded.email WHERE status='active'").bind(userId, email),
      env.DB.prepare("INSERT INTO boing_sessions(token_hash,user_id,workos_session_id,expires_at) SELECT ?,user_id,?,? FROM boing_identities WHERE user_id=? AND status='active' AND email=?").bind(tokenHash, verified.sessionId, expiresAt, userId, email)
    ])
    if (result[1]?.meta?.changes !== 1) return { status: 'denied' }
    return { status: 'created', token, expiresAt }
  } catch { return { status: 'unavailable' } }
}

// token is read from a dedicated host-only, Secure, HttpOnly, SameSite cookie
// by the future Boing auth route. Never return it to scripts or store it in D1.
export async function authenticateBoingSession(env, token, { request = fetch, now = Date.now() } = {}) {
  if (!validConfig(env)) return { status: 'unavailable' }
  if (!validToken(token)) return { status: 'denied' }
  try {
    const tokenHash = await hash(token), at = Math.floor(now / 1000)
    const lookup = () => env.DB.prepare(`SELECT i.user_id, i.email, s.workos_session_id FROM boing_sessions s
      JOIN boing_identities i ON i.user_id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL
      AND s.expires_at>? AND i.status='active'`).bind(tokenHash, at).first()
    const stored = await lookup()
    if (!stored) return { status: 'denied' }
    const state = await workosSessionState({ apiKey: env.WORKOS_API_KEY, userId: stored.user_id, sessionId: stored.workos_session_id, request, now })
    if (state !== 'active') return { status: state === 'inactive' ? 'denied' : 'unavailable' }
    const email = await readVerifiedWorkosEmail(env, stored.user_id, request)
    if (!email || email !== stored.email) return { status: 'denied' }
    const current = await lookup()
    if (!current || current.user_id !== stored.user_id || current.email !== email || current.workos_session_id !== stored.workos_session_id) return { status: 'denied' }
    return { status: 'active', user: { id: stored.user_id, email, verified: 1, status: 'active' } }
  } catch { return { status: 'unavailable' } }
}

export async function revokeBoingSession(env, token, now = Date.now()) {
  if (!env?.DB?.prepare || !validToken(token)) return false
  try {
    const result = await env.DB.prepare('UPDATE boing_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(Math.floor(now / 1000), await hash(token)).run()
    return result.meta?.changes === 1
  } catch { return false }
}

// Unlike revokeBoingSession's boolean result, distinguish storage failure
// from an already revoked or nonexistent session. Call only with a token
// obtained from the host-only session cookie.
export async function endBoingSession(env, token, now = Date.now()) {
  if (!env?.DB?.prepare || !validToken(token)) return { status: 'unavailable' }
  try {
    const result = await env.DB.prepare('UPDATE boing_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL RETURNING workos_session_id').bind(Math.floor(now / 1000), await hash(token)).first()
    const sessionId = result?.workos_session_id
    return typeof sessionId === 'string' && /^session_[A-Za-z0-9]{1,120}$/.test(sessionId)
      ? { status: 'ended', sessionId } : { status: 'ended' }
  } catch { return { status: 'unavailable' } }
}
