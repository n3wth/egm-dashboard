import { resolveBoingContext } from './boing-context.mjs'
import { completeInstallation, listAvailableRepositories, bindRepository } from './boing-github-app.mjs'

// Add to the separate Boing database before enabling these routes.
export const GITHUB_OAUTH_SCHEMA = `CREATE TABLE IF NOT EXISTS boing_github_oauth_flows (
  state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_hash TEXT NOT NULL, organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL, installation_id INTEGER NOT NULL, installation_state TEXT NOT NULL,
  verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS boing_github_install_handoffs (
  state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_hash TEXT NOT NULL,
  organization_id TEXT NOT NULL, project_id TEXT NOT NULL, expires_at INTEGER NOT NULL
);`

const enc = new TextEncoder(), dec = new TextDecoder()
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)))
const hash = async value => b64(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))))
const hexHash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))), b => b.toString(16).padStart(2, '0')).join('')
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const positive = value => Number.isSafeInteger(value) && value > 0
const fail = (error, status) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } })
const cookie = (name, value, maxAge) => `__Host-${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
function getCookie(request, name) {
  const found = (request.headers.get('cookie') ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith(`__Host-${name}=`))
  return found.length === 1 ? found[0].slice(name.length + 8) : null
}
function config(env) {
  try {
    const url = new URL(env.APP_URL)
    return url.protocol === 'https:' && url.origin === env.APP_URL &&
      /^[A-Za-z0-9_]{5,100}$/.test(env.GITHUB_CLIENT_ID ?? '') &&
      typeof env.GITHUB_CLIENT_SECRET === 'string' && env.GITHUB_CLIENT_SECRET.length >= 16 &&
      typeof env.BOING_GITHUB_OAUTH_SECRET === 'string' && env.BOING_GITHUB_OAUTH_SECRET.length >= 32 &&
      positive(Number(env.GITHUB_APP_ID)) && env.DB?.prepare
  } catch { return false }
}
async function key(env) {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode(env.BOING_GITHUB_OAUTH_SECRET)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
async function seal(env, payload) {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await key(env), enc.encode(JSON.stringify(payload))))
  return `${b64(nonce)}.${b64(encrypted)}`
}
async function open(env, value) {
  if (typeof value !== 'string' || value.length > 3500 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const [iv, ciphertext] = value.split('.').map(unb64)
    if (iv.length !== 12) return null
    return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(env), ciphertext)))
  } catch { return null }
}
async function boundedBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return null
  const reader = request.body?.getReader()
  if (!reader) return null
  let total = 0, body = ''
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > 1024) { await reader.cancel(); return null }
      body += decoder.decode(part.value, { stream: true })
    }
    return JSON.parse(body + decoder.decode())
  } catch { return null } finally { reader.releaseLock() }
}
async function authorizedProject(env, user, organizationId, projectId, requestWorkos, expected = null) {
  const context = await resolveBoingContext(env, user, organizationId, requestWorkos)
  if (context.status !== 'allowed' || !['owner', 'admin'].includes(context.role)) return false
  if (env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' && (!context.membershipId || !context.membershipUpdatedAt ||
      (expected && (context.role !== expected.role || context.membershipId !== expected.membershipId || context.membershipUpdatedAt !== expected.membershipUpdatedAt)))) return false
  const allowed = await env.DB.prepare(`SELECT p.id FROM boing_projects p JOIN boing_memberships m ON m.organization_id=p.organization_id
    JOIN boing_identities u ON u.user_id=m.user_id JOIN boing_organizations o ON o.id=p.organization_id
    WHERE p.id=? AND p.organization_id=? AND p.status='active' AND o.status='active' AND m.user_id=? AND m.status='active'
    AND u.status='active' AND (m.role='owner' OR (m.role='admin' AND EXISTS (SELECT 1 FROM boing_project_memberships pm
      WHERE pm.organization_id=p.organization_id AND pm.project_id=p.id AND pm.user_id=m.user_id)))`).bind(projectId, organizationId, user.id).first()
  return allowed ? context : false
}
const bindingGuard = binding => binding ? ` AND m.role=? AND EXISTS (SELECT 1 FROM boing_workos_membership_bindings b WHERE b.organization_id=m.organization_id AND b.user_id=m.user_id AND b.workos_membership_id=? AND b.workos_updated_at=?)` : ''
const bindingValues = binding => binding ? [binding.role, binding.membershipId, binding.membershipUpdatedAt] : []

// Caller authenticates the Boing session and passes its verified user. The
// callback derives workspace/project from a single-use server-side flow, never
// from callback parameters. requestWorkos/requestGithub are test transports.
export async function handleGithubOAuth(request, env, user, organizationSelector, { requestWorkos = fetch, requestGithub = fetch, now = Date.now() } = {}) {
  const path = new URL(request.url).pathname
  if (!['/api/boing/github/install', '/api/boing/github/setup', '/api/boing/github/authorize', '/api/boing/github/callback', '/api/boing/github/repositories', '/api/boing/github/select'].includes(path)) return null
  if (!config(env)) return fail('github_unavailable', 503)
  if (!user || user.status !== 'active' || user.verified !== 1 || !/^user_[A-Za-z0-9]+$/.test(user.id ?? '')) return fail('sign_in_required', 401)
  if (new URL(request.url).origin !== env.APP_URL) return fail('invalid_origin', 403)
  const session = getCookie(request, 'boing_session')
  if (!/^[A-Za-z0-9_-]{43}$/.test(session ?? '')) return fail('sign_in_required', 401)
  const sessionHash = await hash(session)
  try {
    if (path === '/api/boing/github/install') {
      if (request.method !== 'POST') return fail('method_not_allowed', 405)
      if (request.headers.get('origin') !== env.APP_URL) return fail('invalid_origin', 403)
      if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(env.GITHUB_APP_SLUG ?? '')) return fail('github_unavailable', 503)
      const body = await boundedBody(request)
      if (!body || Object.keys(body).join(',') !== 'projectId' || !id(body.projectId) || !id(organizationSelector)) return fail('invalid_request', 400)
      const access = await authorizedProject(env, user, organizationSelector, body.projectId, requestWorkos)
      if (!access) return fail('access_required', 403)
      const binding = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' ? access : null
      const state = random()
      await env.DB.prepare('DELETE FROM boing_github_install_handoffs WHERE state_hash IN (SELECT state_hash FROM boing_github_install_handoffs WHERE expires_at<=? LIMIT 100)').bind(now).run()
      const admitted = await env.DB.prepare(`INSERT INTO boing_github_install_handoffs
        SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM boing_github_install_handoffs WHERE user_id=? AND organization_id=? AND expires_at>?)<3
        AND (SELECT count(*) FROM boing_github_install_handoffs WHERE organization_id=? AND expires_at>?)<20
        AND EXISTS (SELECT 1 FROM boing_memberships m JOIN boing_identities u ON u.user_id=m.user_id
          JOIN boing_organizations o ON o.id=m.organization_id JOIN boing_projects p ON p.organization_id=o.id
          WHERE m.user_id=? AND m.organization_id=? AND m.status='active' AND u.status='active' AND o.status='active'
          AND p.id=? AND p.status='active' AND (m.role='owner' OR (m.role='admin' AND EXISTS
            (SELECT 1 FROM boing_project_memberships pm WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id)))${bindingGuard(binding)})`)
        .bind(await hash(state), user.id, sessionHash, organizationSelector, body.projectId, now + 600000,
          user.id, organizationSelector, now, organizationSelector, now, user.id, organizationSelector, body.projectId, ...bindingValues(binding)).run()
      if (admitted.meta?.changes !== 1) return fail('github_authorization_limit', 429)
      const url = new URL(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`)
      url.searchParams.set('state', state)
      return Response.json({ url: url.href }, { headers: { 'cache-control': 'no-store', 'set-cookie': cookie('boing_github_install', state, 600) } })
    }
    if (path === '/api/boing/github/setup') {
      if (request.method !== 'GET') return fail('method_not_allowed', 405)
      const url = new URL(request.url), states = url.searchParams.getAll('state'), installations = url.searchParams.getAll('installation_id')
      if (states.length !== 1 || installations.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(states[0]) ||
          getCookie(request, 'boing_github_install') !== states[0] || !/^[1-9][0-9]{0,15}$/.test(installations[0]) || !positive(Number(installations[0]))) return fail('invalid_flow', 400)
      const flow = await env.DB.prepare('DELETE FROM boing_github_install_handoffs WHERE state_hash=? AND user_id=? AND session_hash=? AND expires_at>? RETURNING organization_id,project_id')
        .bind(await hash(states[0]), user.id, sessionHash, now).first()
      if (!flow) return fail('access_required', 403)
      // The setup parameter is only a selector. The subsequent OAuth callback
      // verifies this installation belongs to the authorized GitHub user and app.
      const authorization = await handleGithubOAuth(new Request(`${env.APP_URL}/api/boing/github/authorize`, {
        method: 'POST', headers: { origin: env.APP_URL, 'content-type': 'application/json', cookie: request.headers.get('cookie') ?? '' },
        body: JSON.stringify({ projectId: flow.project_id, installationId: Number(installations[0]) })
      }), env, user, flow.organization_id, { requestWorkos, requestGithub, now })
      if (!authorization.ok) return authorization
      const { url: target } = await authorization.json()
      const headers = new Headers({ location: target, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
      headers.append('set-cookie', cookie('boing_github_install', '', 0))
      const flowCookie = authorization.headers.get('set-cookie')
      if (!flowCookie) return fail('github_unavailable', 503)
      headers.append('set-cookie', flowCookie)
      return new Response(null, { status: 303, headers })
    }
    if (path === '/api/boing/github/authorize') {
      if (request.method !== 'POST') return fail('method_not_allowed', 405)
      if (request.headers.get('origin') !== env.APP_URL) return fail('invalid_origin', 403)
      const body = await boundedBody(request)
      if (!body || Object.keys(body).sort().join(',') !== 'installationId,projectId' || !id(body.projectId) || !positive(body.installationId) || !id(organizationSelector)) return fail('invalid_request', 400)
      const access = await authorizedProject(env, user, organizationSelector, body.projectId, requestWorkos)
      if (!access) return fail('access_required', 403)
      const binding = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' ? access : null
      const state = random(), verifier = random()
      const installState = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
      await env.DB.prepare('DELETE FROM boing_github_oauth_flows WHERE state_hash IN (SELECT state_hash FROM boing_github_oauth_flows WHERE expires_at<=? LIMIT 100)').bind(now).run()
      await env.DB.prepare('DELETE FROM boing_github_install_states WHERE state_hash IN (SELECT state_hash FROM boing_github_install_states WHERE expires_at<=? OR consumed_at IS NOT NULL LIMIT 100)').bind(now).run()
      const [admitted, installation] = await env.DB.batch([
        env.DB.prepare(`INSERT INTO boing_github_oauth_flows SELECT ?,?,?,?,?,?,?,?,?
          WHERE (SELECT count(*) FROM boing_github_oauth_flows WHERE user_id=? AND organization_id=? AND expires_at>?)<3
          AND (SELECT count(*) FROM boing_github_oauth_flows WHERE organization_id=? AND expires_at>?)<20
          AND EXISTS (SELECT 1 FROM boing_memberships m JOIN boing_identities u ON u.user_id=m.user_id
            JOIN boing_organizations o ON o.id=m.organization_id JOIN boing_projects p ON p.organization_id=o.id
            WHERE m.user_id=? AND m.organization_id=? AND m.status='active' AND u.status='active' AND o.status='active'
            AND p.id=? AND p.status='active' AND (m.role='owner' OR (m.role='admin' AND EXISTS
              (SELECT 1 FROM boing_project_memberships pm WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id)))${bindingGuard(binding)})`)
          .bind(await hash(state), user.id, sessionHash, organizationSelector, body.projectId, body.installationId, installState, verifier, now + 600000,
            user.id, organizationSelector, now, organizationSelector, now, user.id, organizationSelector, body.projectId, ...bindingValues(binding)),
        env.DB.prepare('INSERT INTO boing_github_install_states(state_hash,organization_id,user_id,expires_at) SELECT ?,?,?,? WHERE changes()=1')
          .bind(await hexHash(installState), organizationSelector, user.id, now + 600000)
      ])
      if (admitted.meta?.changes !== 1 || installation.meta?.changes !== 1) return fail('github_authorization_limit', 429)
      const url = new URL('https://github.com/login/oauth/authorize')
      url.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${env.APP_URL}/api/boing/github/callback`, state, code_challenge: await hash(verifier), code_challenge_method: 'S256' })
      return Response.json({ url: url.href }, { headers: { 'cache-control': 'no-store', 'set-cookie': cookie('boing_github_flow', state, 600) } })
    }
    if (path === '/api/boing/github/callback') {
      if (request.method !== 'GET') return fail('method_not_allowed', 405)
      const url = new URL(request.url), states = url.searchParams.getAll('state'), codes = url.searchParams.getAll('code')
      if (states.length !== 1 || codes.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(states[0]) || getCookie(request, 'boing_github_flow') !== states[0] || !/^[A-Za-z0-9_-]{1,256}$/.test(codes[0])) return fail('invalid_flow', 400)
      const flow = await env.DB.prepare('DELETE FROM boing_github_oauth_flows WHERE state_hash=? AND user_id=? AND session_hash=? AND expires_at>? RETURNING *').bind(await hash(states[0]), user.id, sessionHash, now).first()
      const access = flow && await authorizedProject(env, user, flow.organization_id, flow.project_id, requestWorkos)
      if (!access) return fail('access_required', 403)
      const membershipBinding = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' ? access : null
      const tokenResponse = await requestGithub('https://github.com/login/oauth/access_token', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: codes[0], redirect_uri: `${env.APP_URL}/api/boing/github/callback`, code_verifier: flow.verifier }) })
      if (!tokenResponse.ok) return fail('github_unavailable', 502)
      const token = await tokenResponse.json()
      if (typeof token.access_token !== 'string' || token.access_token.length > 1024 || !/^ghu_[A-Za-z0-9_]+$/.test(token.access_token)) return fail('github_unavailable', 502)
      const checkedGithub = async (...args) => {
        const result = await requestGithub(...args)
        if (!await authorizedProject(env, user, flow.organization_id, flow.project_id, requestWorkos, membershipBinding)) throw new Error('access revoked')
        return result
      }
      await completeInstallation(env.DB, { state: flow.installation_state, userId: user.id, installationId: flow.installation_id, appId: Number(env.GITHUB_APP_ID), userAccessToken: token.access_token, now, membershipBinding }, checkedGithub)
      if (!await authorizedProject(env, user, flow.organization_id, flow.project_id, requestWorkos, membershipBinding)) return fail('access_required', 403)
      const sealed = await seal(env, { userId: user.id, sessionHash, organizationId: flow.organization_id, projectId: flow.project_id, installationId: flow.installation_id, token: token.access_token, expires: Math.min(now + 300000, now + (Number.isFinite(token.expires_in) ? Math.max(0, token.expires_in) * 1000 : 300000)) })
      if (sealed.length > 3500) return fail('github_unavailable', 502)
      const headers = new Headers({ location: '/', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
      headers.append('set-cookie', cookie('boing_github_flow', '', 0))
      headers.append('set-cookie', cookie('boing_github_selection', sealed, 300))
      return new Response(null, { status: 303, headers })
    }
    if (!['GET', 'POST'].includes(request.method)) return fail('method_not_allowed', 405)
    const selection = await open(env, getCookie(request, 'boing_github_selection'))
    if (!selection || selection.userId !== user.id || selection.sessionHash !== sessionHash || selection.expires <= now || selection.organizationId !== organizationSelector || !id(selection.projectId) || !positive(selection.installationId)) return fail('github_authorization_required', 403)
    const access = await authorizedProject(env, user, selection.organizationId, selection.projectId, requestWorkos)
    if (!access) return fail('access_required', 403)
    const membershipBinding = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' ? access : null
    if (path === '/api/boing/github/repositories') {
      if (request.method !== 'GET') return fail('method_not_allowed', 405)
      const repositories = await listAvailableRepositories(env.DB, { ...selection, userAccessToken: selection.token }, requestGithub)
      if (!await authorizedProject(env, user, selection.organizationId, selection.projectId, requestWorkos, membershipBinding)) return fail('access_required', 403)
      return Response.json({ projectId: selection.projectId, repositories }, { headers: { 'cache-control': 'no-store' } })
    }
    if (request.method !== 'POST') return fail('method_not_allowed', 405)
    if (request.headers.get('origin') !== env.APP_URL) return fail('invalid_origin', 403)
    const body = await boundedBody(request)
    if (!body || Object.keys(body).join(',') !== 'repositoryId' || !positive(body.repositoryId)) return fail('invalid_request', 400)
    const checkedGithub = async (...args) => {
      const result = await requestGithub(...args)
      if (!await authorizedProject(env, user, selection.organizationId, selection.projectId, requestWorkos, membershipBinding)) throw new Error('access revoked')
      return result
    }
    await bindRepository(env.DB, { ...selection, userAccessToken: selection.token, repositoryId: body.repositoryId, membershipBinding }, checkedGithub)
    return Response.json({ connected: true }, { headers: { 'cache-control': 'no-store', 'set-cookie': cookie('boing_github_selection', '', 0) } })
  } catch { return fail('github_unavailable', 503) }
}
