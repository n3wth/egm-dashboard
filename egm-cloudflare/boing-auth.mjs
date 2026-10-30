import { createBoingSession, endBoingSession } from './boing-identity.mjs'
import { acceptWorkosInvitationToken } from './boing-accept.mjs'
import { lookupBoundInvite, openInviteToken, sealInviteToken } from './boing-invite-auth.mjs'
import { normalizeInvitationEmail } from './boing-invites.mjs'

export const BOING_AUTH_SCHEMA = `CREATE TABLE IF NOT EXISTS boing_auth_flows (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS boing_auth_flows_expiry ON boing_auth_flows(expires_at);
CREATE TABLE IF NOT EXISTS boing_auth_rate_limits (
  client_hash TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS boing_auth_rate_limits_expiry ON boing_auth_rate_limits(expires_at);`

const enc = new TextEncoder()
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const un64 = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)))
const digest = async value => b64(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))))
const key = secret => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
const cookie = (name, value, seconds) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`
const noCache = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }
// WorkOS may accept an organization invitation for a different user at the
// same corporate domain. Do not enable until the deployed provider flow has
// a verified way to enforce the intended recipient before membership creation.
const invitationAuthEnabled = env => env.BOING_INVITATION_AUTH_ENABLED === 'true' && env.BOING_INVITATION_RECIPIENT_CONTROLS_VERIFIED === 'true'
const error = (message, status) => {
  const headers = new Headers(noCache)
  headers.append('set-cookie', cookie('__Host-boing_flow', '', 0))
  headers.append('set-cookie', cookie('__Host-boing_invite', '', 0))
  return new Response(message, { status, headers })
}
export const BOING_AUTH_FLOW_CAP = 1024
export const BOING_LOGIN_LIMIT = 8
export const BOING_LOGIN_WINDOW_SECONDS = 60
export const BOING_LOGIN_CLIENT_CAP = 4096

// Cloudflare populates request.cf and CF-Connecting-IP for direct edge
// requests. Do not expose this Worker through another same-zone Worker or
// service binding: that path can supply a spoofed client IP.
function clientIp(request) {
  if (!request.cf || typeof request.cf.colo !== 'string' || !/^[A-Z]{3}$/.test(request.cf.colo)) return null
  const ip = request.headers.get('cf-connecting-ip')
  if (!ip || ip.length > 45 || /[^0-9a-fA-F:.]/.test(ip)) return null
  try {
    if (ip.includes(':')) {
      const host = new URL(`http://[${ip}]/`).hostname
      return host.slice(1, -1)
    }
    const parts = ip.split('.')
    if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255 || (part.length > 1 && part.startsWith('0')))) return null
    return parts.join('.')
  } catch { return null }
}

async function admitLogin(request, env, at) {
  const ip = clientIp(request)
  if (!ip) return 'unavailable'
  const material = await key(env.BOING_AUTH_SECRET)
  const clientHash = b64(new Uint8Array(await crypto.subtle.sign('HMAC', material, enc.encode(`boing-login-ip\0${ip}`))))
  await env.DB.prepare('DELETE FROM boing_auth_rate_limits WHERE client_hash IN (SELECT client_hash FROM boing_auth_rate_limits WHERE expires_at<=? LIMIT 128)').bind(at).run()
  const row = await env.DB.prepare(`INSERT INTO boing_auth_rate_limits(client_hash,count,expires_at)
    SELECT ?,1,? WHERE (SELECT COUNT(*) FROM boing_auth_rate_limits)<? OR EXISTS (SELECT 1 FROM boing_auth_rate_limits WHERE client_hash=?)
    ON CONFLICT(client_hash) DO UPDATE SET
      count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
    WHERE expires_at<=? OR count<?
    RETURNING count`).bind(clientHash, at + BOING_LOGIN_WINDOW_SECONDS, BOING_LOGIN_CLIENT_CAP, clientHash,
      at, at, at, BOING_LOGIN_LIMIT).first()
  return row ? 'allowed' : 'limited'
}

function validConfiguration(env) {
  try {
    const url = new URL(env.APP_URL)
    return url.protocol === 'https:' && url.origin === env.APP_URL && !url.username && !url.password &&
      typeof env.BOING_AUTH_SECRET === 'string' && env.BOING_AUTH_SECRET.length >= 48 &&
      /^client_[A-Za-z0-9]+$/.test(env.WORKOS_CLIENT_ID ?? '') && typeof env.WORKOS_API_KEY === 'string' &&
      !!env.WORKOS_API_KEY && env.DB?.prepare
  } catch { return false }
}

function flowCookie(request) {
  const values = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim())
    .filter(part => part.startsWith('__Host-boing_flow='))
  return values.length === 1 ? values[0].slice('__Host-boing_flow='.length) : null
}

function inviteCookie(request) {
  const values = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim())
    .filter(part => part.startsWith('__Host-boing_invite='))
  return values.length === 1 ? values[0].slice('__Host-boing_invite='.length) : null
}

// Unwired auth endpoints. State is both signed and stored for one-time use;
// PKCE verifier stays server-side. The trusted options are for local tests.
export async function handleBoingAuth(request, env, { requestWorkos = fetch, createSession = createBoingSession, endSession = endBoingSession, acceptInvite = acceptWorkosInvitationToken, now = Date.now(), loginAdmission = admitLogin } = {}) {
  try {
    const url = new URL(request.url)
    if (!['/auth/boing/login', '/auth/boing/callback'].includes(url.pathname)) return null
    if (!validConfiguration(env)) return error('Sign-in unavailable', 503)
    if (url.origin !== env.APP_URL) return error('Not found', 404)
    if (request.method !== 'GET') return error('Method not allowed', 405)
    const origin = request.headers.get('origin')
    if (origin && origin !== env.APP_URL) return error('Invalid origin', 403)
    const at = Math.floor(now / 1000)
    if (url.pathname === '/auth/boing/login') {
      const admission = await loginAdmission(request, env, at)
      if (admission === 'limited') return new Response('Sign-in temporarily unavailable', { status: 429, headers: { ...noCache, 'retry-after': String(BOING_LOGIN_WINDOW_SECONDS) } })
      if (admission !== 'allowed') return error('Sign-in unavailable', 503)
      const inviteParams = url.searchParams.getAll('invitation_token')
      if (inviteParams.length > 1) return error('Invalid invitation', 400)
      const invitationToken = inviteParams[0] ?? null
      if (inviteParams.length && !invitationAuthEnabled(env)) return error('Invitation sign-in unavailable', 503)
      if (invitationToken && !await lookupBoundInvite(env, invitationToken, requestWorkos, now)) return error('Invitation unavailable', 403)
      const nonce = random(), verifier = random()
      const signedValue = `${nonce}\0${env.APP_URL}${invitationToken ? '\0invite' : ''}`
      const state = `${nonce}.${b64(new Uint8Array(await crypto.subtle.sign('HMAC', await key(env.BOING_AUTH_SECRET), enc.encode(signedValue))))}${invitationToken ? '.i' : ''}`
      // Delete only expired flows, in bounded batches. Count and insert in one
      // statement so concurrent admissions cannot exceed the global cap.
      await env.DB.prepare('DELETE FROM boing_auth_flows WHERE state_hash IN (SELECT state_hash FROM boing_auth_flows WHERE expires_at<=? LIMIT 128)').bind(at).run()
      const admitted = await env.DB.prepare('INSERT INTO boing_auth_flows(state_hash,verifier,expires_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM boing_auth_flows)<?').bind(await digest(state), verifier, at + 600, BOING_AUTH_FLOW_CAP).run()
      if (admitted?.meta?.changes !== 1) return new Response('Sign-in temporarily unavailable', { status: 429, headers: { ...noCache, 'retry-after': '60' } })
      const authorization = new URL('https://api.workos.com/user_management/authorize')
      for (const [name, value] of Object.entries({ client_id: env.WORKOS_CLIENT_ID, provider: 'authkit', redirect_uri: `${env.APP_URL}/auth/boing/callback`, response_type: 'code', state, code_challenge: await digest(verifier), code_challenge_method: 'S256' })) authorization.searchParams.set(name, value)
      if (invitationToken) authorization.searchParams.set('invitation_token', invitationToken)
      const headers = new Headers({ ...noCache, location: authorization.href })
      headers.append('set-cookie', cookie('__Host-boing_flow', state, 600))
      headers.append('set-cookie', cookie('__Host-boing_invite', invitationToken ? await sealInviteToken(invitationToken, state, env.BOING_AUTH_SECRET) : '', invitationToken ? 600 : 0))
      return new Response(null, { status: 302, headers })
    }
    const state = url.searchParams.get('state'), code = url.searchParams.get('code')
    if (url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1 ||
        !state || state !== flowCookie(request) || !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}(?:\.i)?$/.test(state) ||
        typeof code !== 'string' || !code || code.length > 2048) return error('Invalid sign-in state', 400)
    const [nonce, signature, inviteMarker] = state.split('.')
    if (!await crypto.subtle.verify('HMAC', await key(env.BOING_AUTH_SECRET), un64(signature), enc.encode(`${nonce}\0${env.APP_URL}${inviteMarker ? '\0invite' : ''}`))) return error('Invalid sign-in state', 400)
    if (inviteMarker && !invitationAuthEnabled(env)) return error('Invitation sign-in unavailable', 503)
    // Atomic deletion claims the verifier before any network call: concurrent
    // callbacks and retries cannot exchange the same authorization code twice.
    const flow = await env.DB.prepare('DELETE FROM boing_auth_flows WHERE state_hash=? AND expires_at>? RETURNING verifier').bind(await digest(state), at).first()
    if (!flow?.verifier) return error('Invalid sign-in state', 400)
    const invitationToken = inviteMarker ? await openInviteToken(inviteCookie(request), state, env.BOING_AUTH_SECRET) : null
    const invitation = inviteMarker && invitationToken ? await lookupBoundInvite(env, invitationToken, requestWorkos, now) : null
    if (inviteMarker && !invitation) return error('Invitation unavailable', 403)
    const result = await requestWorkos('https://api.workos.com/user_management/authenticate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ client_id: env.WORKOS_CLIENT_ID, client_secret: env.WORKOS_API_KEY, grant_type: 'authorization_code', code, code_verifier: flow.verifier, ...(invitationToken ? { invitation_token: invitationToken } : {}) })
    })
    if (!result.ok) return error('Sign-in failed', 401)
    const data = await result.json()
    if (!/^user_[A-Za-z0-9]+$/.test(data?.user?.id ?? '') || typeof data.access_token !== 'string' || data.user.email_verified !== true) return error('Sign-in failed', 401)
    if (invitation && normalizeInvitationEmail(data.user.email) !== invitation.email) return error('Invitation unavailable', 403)
    const session = await createSession(env, data.user.id, data.access_token, { request: requestWorkos, now })
    if (session?.status !== 'created' || !/^[A-Za-z0-9_-]{43}$/.test(session.token ?? '') || !Number.isFinite(session.expiresAt) || session.expiresAt <= at) return error('Sign-in unavailable', 503)
    if (invitationToken) {
      let accepted
      try {
        accepted = await acceptInvite(env, invitationToken, { id: data.user.id, email: data.user.email, status: 'active', verified: 1 }, { request: requestWorkos, now: () => new Date(now).toISOString() })
      } catch { accepted = { status: 'unavailable' } }
      if (!['accepted', 'already_accepted'].includes(accepted?.status)) {
        // No cookie is issued on failure. Revoke the local session as well;
        // its token never leaves the server, even if cleanup is unavailable.
        try { await endSession(env, session.token, now) } catch {}
        return error('Invitation unavailable', accepted?.status === 'unavailable' ? 503 : 403)
      }
    }
    const headers = new Headers({ ...noCache, location: '/' })
    headers.append('set-cookie', cookie('__Host-boing_flow', '', 0))
    headers.append('set-cookie', cookie('__Host-boing_invite', '', 0))
    headers.append('set-cookie', cookie('__Host-boing_session', session.token, Math.max(0, Math.min(1800, session.expiresAt - at))))
    return new Response(null, { status: 302, headers })
  } catch {
    return error('Sign-in unavailable', 503)
  }
}
