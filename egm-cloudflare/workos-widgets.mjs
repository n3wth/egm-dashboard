import { workosSigningKey } from './workos-jwks.mjs'

// Widget and session contracts: https://workos.com/docs/widgets/tokens
// https://workos.com/docs/reference/authkit/session
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
const text = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()
const userPattern = /^user_[A-Za-z0-9]+$/
const sessionPattern = /^session_[A-Za-z0-9]+$/

// The WorkOS session ID must be obtained from a verified access token, never
// from the browser or the locally signed opaque session cookie.
// allowExpiredForBinding is exclusively for comparing an old signed token's
// session ID with a refreshed token. Never use that result for authorization.
export async function verifyWorkosSessionToken(token, { clientId, issuer, userId, request = fetch, now = Date.now(), allowExpiredForBinding = false }) {
  try {
    if (typeof token !== 'string' || token.length > 8192 || !/^client_[A-Za-z0-9]+$/.test(clientId ?? '') || !userPattern.test(userId ?? '') || typeof issuer !== 'string' || !issuer) return null
    const parts = token.split('.')
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null
    const [head, body, signature] = parts
    const header = JSON.parse(text.decode(decode(head))), claims = JSON.parse(text.decode(decode(body)))
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.crit != null || header.b64 === false || claims.iss !== issuer || claims.client_id !== clientId || claims.sub !== userId || !sessionPattern.test(claims.sid ?? '') || !Number.isFinite(claims.exp) || (!allowExpiredForBinding && claims.exp <= Math.floor(now / 1000)) || (claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > Math.floor(now / 1000)))) return null
    const jwk = await workosSigningKey(clientId, header.kid, request, now)
    if (!jwk) return null
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(signature), encoder.encode(`${head}.${body}`)) ? { sessionId: claims.sid } : null
  } catch { return null }
}

// Search the active WorkOS sessions, with a bounded scan. Only a fully scanned
// list proves a session absent. Provider errors and truncated scans are not
// treated as evidence that a user revoked a session.
export async function workosSessionState({ apiKey, userId, sessionId, request = fetch, now = Date.now() }) {
  if (!apiKey || !userPattern.test(userId ?? '') || !sessionPattern.test(sessionId ?? '')) return 'unavailable'
  const seen = new Set()
  let after
  try {
    for (let page = 0; page < 3; page++) {
      const url = new URL(`https://api.workos.com/user_management/users/${userId}/sessions`)
      url.searchParams.set('limit', '100')
      url.searchParams.set('order', 'desc')
      if (after) url.searchParams.set('after', after)
      const response = await request(url.toString(), { headers: { authorization: `Bearer ${apiKey}` }, redirect: 'manual', signal: AbortSignal.timeout(5000) })
      if (!response.ok) return 'unavailable'
      const body = await response.json()
      if (!Array.isArray(body.data) || body.data.length > 100 || !body.list_metadata || !Object.hasOwn(body.list_metadata, 'after')) return 'unavailable'
      const ids = new Set()
      for (const row of body.data) {
        if (!row || !sessionPattern.test(row.id ?? '') || row.user_id !== userId || !['active', 'revoked', 'expired'].includes(row.status) || !Number.isFinite(Date.parse(row.expires_at)) || ids.has(row.id)) return 'unavailable'
        ids.add(row.id)
      }
      const found = body.data.find(row => row.id === sessionId)
      if (found) {
        if (found.user_id !== userId || !['active', 'revoked', 'expired'].includes(found.status)) return 'unavailable'
        if (found.status !== 'active') return 'inactive'
        const expiry = Date.parse(found.expires_at)
        if (!Number.isFinite(expiry)) return 'unavailable'
        return expiry > now ? 'active' : 'inactive'
      }
      const cursor = body.list_metadata.after
      if (cursor === null) return 'inactive'
      if (!sessionPattern.test(cursor ?? '') || seen.has(cursor)) return 'unavailable'
      seen.add(cursor); after = cursor
    }
  } catch { return 'unavailable' }
  return 'unavailable'
}

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })

// The caller must first authenticate the local D1 session and supply its stored
// WorkOS token. Widget tokens are minted for that user only, without an org or
// elevated scopes. Never accept the subject, session ID or scopes from input.
export async function issueUserSessionsWidgetToken(request, env, user, workosToken, fetcher = fetch) {
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)
  if (request.headers.get('origin') !== env.APP_URL) return reply({ error: 'invalid_origin' }, 403)
  if (!user || user.status !== 'approved' || user.verified !== 1 || !userPattern.test(user.id ?? '')) return reply({ error: 'sign_in_required' }, 401)
  if (env.WORKOS_WIDGETS_ENABLED !== 'true' || !env.WORKOS_API_KEY) return reply({ error: 'widgets_unavailable' }, 503)
  const verified = await verifyWorkosSessionToken(workosToken, { clientId: env.WORKOS_CLIENT_ID, issuer: env.WORKOS_RBAC_ISSUER, userId: user.id, request: fetcher })
  if (!verified) return reply({ error: 'reauthenticate' }, 401)
  const state = await workosSessionState({ apiKey: env.WORKOS_API_KEY, userId: user.id, sessionId: verified.sessionId, request: fetcher })
  if (state !== 'active') return reply({ error: state === 'inactive' ? 'reauthenticate' : 'widgets_unavailable' }, state === 'inactive' ? 401 : 503)
  try {
    const response = await fetcher('https://api.workos.com/widgets/token', { method: 'POST', headers: { authorization: `Bearer ${env.WORKOS_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ user_id: user.id, scopes: [] }), redirect: 'manual', signal: AbortSignal.timeout(5000) })
    if (!response.ok) return reply({ error: 'widgets_unavailable' }, 503)
    const { token } = await response.json()
    if (typeof token !== 'string' || !token || token.length > 16384) return reply({ error: 'widgets_unavailable' }, 503)
    return reply({ token, currentSessionId: verified.sessionId })
  } catch { return reply({ error: 'widgets_unavailable' }, 503) }
}
