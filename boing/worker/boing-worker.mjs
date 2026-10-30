import { authenticateBoingSession, endBoingSession } from './boing-identity.mjs'
import { handleBoingRoute } from './boing-router.mjs'
import { handleBoingAuth } from './boing-auth.mjs'
import { resolveBoingContext } from './boing-context.mjs'
import { handleInvitationAcceptance } from './boing-onboarding.mjs'
import { handleBoingAccount } from './boing-account.mjs'
import { runCollectionTick } from './boing-scheduler.mjs'
import { handleBoingGithubWebhook } from './boing-webhook.mjs'
import { handleGithubOAuth } from './boing-github-oauth.mjs'
import { handlePlatformProvision } from './boing-platform-admin.mjs'

const failure = (error, status) => Response.json({ error }, {
  status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
})

// Separate entrypoint from the legacy Worker. Auth and API routes use only
// Boing sessions. Invitation acceptance requires an existing WorkOS membership.
// Only these app assets are served, and only after session verification. The
// binding directory also contains tests and documentation; never expose them.
const appAssets = new Set(['/', '/index.html', '/account.html', '/account.mjs', '/admin.html', '/admin.mjs', '/style.css', '/app.mjs', '/api.mjs', '/members.mjs', '/invitations.mjs', '/archive.mjs', '/audit.mjs', '/history.mjs', '/logo/boing-approved.png'])
const reservedSubdomains = new Set(['app', 'www', 'api', 'admin', 'mail', 'auth', 'staging'])

// A configured base only opts into hostname selection. It never grants access.
// The deployment must separately route and secure these hosts, and register
// their AuthKit callbacks. Each host gets its own __Host session cookie.
async function tenantForOrigin(url, env) {
  if (!env.BOING_TENANT_BASE_URL) return null
  let base, app
  try {
    base = new URL(env.BOING_TENANT_BASE_URL)
    app = new URL(env.APP_URL)
  } catch { return null }
  if (base.protocol !== 'https:' || base.origin !== env.BOING_TENANT_BASE_URL ||
      base.port || base.username || base.password || app.protocol !== 'https:' ||
      app.origin !== env.APP_URL || (app.hostname !== base.hostname && !app.hostname.endsWith(`.${base.hostname}`)) ||
      url.protocol !== 'https:' || url.port || !url.hostname.endsWith(`.${base.hostname}`)) return null
  const slug = url.hostname.slice(0, -(base.hostname.length + 1))
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) ||
      slug.startsWith('xn--') || reservedSubdomains.has(slug)) return null
  const row = await env.DB.prepare(`SELECT o.id, o.name FROM boing_organization_subdomains s
    JOIN boing_organizations o ON o.id=s.organization_id
    WHERE s.slug=? AND o.status='active'`).bind(slug).first()
  if (!row || !/^[A-Za-z0-9_-]{1,128}$/.test(row.id ?? '') || typeof row.name !== 'string') return null
  return { slug, id: row.id, name: row.name }
}

function sessionCookie(request) {
  const matches = (request.headers.get('cookie') ?? '').split(';')
    .map(part => part.trim()).filter(part => part.startsWith('__Host-boing_session='))
  return matches.length === 1 ? matches[0].slice('__Host-boing_session='.length) : null
}

export function createBoingWorker({ authenticate = authenticateBoingSession, endSession = endBoingSession, route = handleBoingRoute, auth = handleBoingAuth, resolveContext = resolveBoingContext, acceptInvitation = handleInvitationAcceptance, collectionTick = runCollectionTick, githubWebhook = handleBoingGithubWebhook, githubOAuth = handleGithubOAuth, platformProvision = handlePlatformProvision } = {}) {
  return {
    async scheduled(_event, env) {
      await collectionTick(env)
    },
    async fetch(request, env, executionContext) {
      try {
        const url = new URL(request.url)
        if (!env?.APP_URL) return failure('not_found', 404)
        const configuredEnv = env
        const tenant = url.origin === env.APP_URL ? null : await tenantForOrigin(url, env)
        if (url.origin !== env.APP_URL && !tenant) return failure('not_found', 404)
        // All existing origin/CSRF and host-only cookie checks remain exact.
        if (tenant) env = { ...env, APP_URL: url.origin }
        const origin = request.headers.get('origin')
        if (origin && origin !== env.APP_URL) return failure('invalid_origin', 403)
        if (url.pathname === '/webhooks/github') {
          if (tenant) return failure('not_found', 404)
          return await githubWebhook(request, env)
        }
        if (url.pathname === '/auth/boing/login' || url.pathname === '/auth/boing/callback') {
          return await auth(request, env) ?? failure('not_found', 404)
        }
        if (url.pathname === '/auth/logout') {
          if (request.method !== 'POST') return failure('method_not_allowed', 405)
          if (origin !== env.APP_URL) return failure('invalid_origin', 403)
          const cookieCount = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith('__Host-boing_session=')).length
          if (cookieCount > 1) return failure('invalid_session', 400)
          const token = sessionCookie(request)
          let sessionId
          if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
            const ended = await endSession(env, token)
            if (ended?.status !== 'ended') return failure('service_unavailable', 503)
            sessionId = ended.sessionId
          }
          if (typeof sessionId === 'string' && /^session_[A-Za-z0-9]{1,120}$/.test(sessionId)) {
            const logoutUrl = new URL('https://api.workos.com/user_management/sessions/logout')
            logoutUrl.searchParams.set('session_id', sessionId)
            return new Response(null, { status: 303, headers: {
              location: logoutUrl.href, 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer',
              'set-cookie': '__Host-boing_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'
            } })
          }
          return new Response('<!doctype html><html lang="en"><title>Signed out · Boing</title><p>You are signed out of Boing.</p><a href="/auth/boing/login">Sign in</a></html>', {
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'", 'set-cookie': '__Host-boing_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0' }
          })
        }
        const isAsset = appAssets.has(url.pathname)
        if (!isAsset && url.pathname !== '/api/boing' && !url.pathname.startsWith('/api/boing/')) return failure('not_found', 404)
        if (isAsset && !['GET', 'HEAD'].includes(request.method)) return failure('method_not_allowed', 405)
        const token = sessionCookie(request)
        if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
          if (isAsset && ['/', '/index.html', '/account.html'].includes(url.pathname)) return Response.redirect(new URL('/auth/boing/login', env.APP_URL), 302)
          return failure('sign_in_required', 401)
        }
        const current = await authenticate(env, token)
        if (current?.status === 'denied') {
          if (isAsset && ['/', '/index.html', '/account.html'].includes(url.pathname)) return Response.redirect(new URL('/auth/boing/login', env.APP_URL), 302)
          return failure('sign_in_required', 401)
        }
        if (current?.status !== 'active') return failure('service_unavailable', 503)
        const user = current.user
        if (!user || user.status !== 'active' || user.verified !== 1 || !/^user_[A-Za-z0-9]+$/.test(user.id ?? '')) return failure('sign_in_required', 401)
        let tenantContext
        if (tenant) {
          tenantContext = await resolveContext(env, user, tenant.id)
          if (tenantContext?.status === 'unavailable') return failure('service_unavailable', 503)
          if (tenantContext?.status !== 'allowed' || tenantContext.organizationId !== tenant.id || tenantContext.userId !== user.id) return failure('organization_access_required', 403)
          const currentTenant = await tenantForOrigin(url, configuredEnv)
          if (!currentTenant || currentTenant.id !== tenant.id) return failure('organization_access_required', 403)
        }
        const account = handleBoingAccount(request, user)
        if (account) return account
        if (url.pathname === '/api/boing/platform/workspaces') {
          if (tenant) return failure('not_found', 404)
          return await platformProvision(request, env, user) ?? failure('not_found', 404)
        }
        if (isAsset) {
          if (!env.ASSETS?.fetch) return failure('service_unavailable', 503)
          // Do not send cookies or user-supplied headers to the static binding.
          const assetUrl = new URL(url.pathname === '/' ? '/index.html' : url.pathname, env.APP_URL)
          const asset = await env.ASSETS.fetch(new Request(assetUrl, { method: request.method }))
          if (!asset.ok) return failure('not_found', 404)
          const headers = new Headers(asset.headers)
          headers.set('cache-control', 'private, no-store')
          headers.set('x-content-type-options', 'nosniff')
          headers.set('x-frame-options', 'DENY')
          headers.set('content-security-policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
          return new Response(asset.body, { status: asset.status, headers })
        }
        if (url.pathname === '/api/boing/organizations') {
          if (request.method !== 'GET') return failure('method_not_allowed', 405)
          if (tenant) return Response.json({ organizations: [{ id: tenant.id, name: tenant.name, role: tenantContext.role }], truncated: false }, { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
          const rows = await env.DB.prepare(`SELECT o.id, o.name FROM boing_organizations o
            JOIN boing_memberships m ON m.organization_id=o.id
            JOIN boing_identities i ON i.user_id=m.user_id
            WHERE m.user_id=? AND m.status='active' AND o.status='active' AND i.status='active'
            ORDER BY o.id LIMIT 21`).bind(user.id).all()
          if (!Array.isArray(rows?.results)) return failure('service_unavailable', 503)
          const candidates = rows.results.slice(0, 20)
          const checks = await Promise.all(candidates.map(row => resolveContext(env, user, row.id)))
          if (checks.some(check => check?.status === 'unavailable' || !['allowed', 'denied'].includes(check?.status))) return failure('service_unavailable', 503)
          const organizations = candidates.flatMap((row, index) => checks[index].status === 'allowed' ? [{ id: row.id, name: row.name, role: checks[index].role }] : [])
          return Response.json({ organizations, truncated: rows.results.length > 20 }, { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
        }
        // A host can be reassigned while a request is in flight. Until mapping
        // lifecycle and mutations are bound in one transaction, only reads are
        // permitted on tenant hosts. Same-origin logout is handled above.
        if (tenant && !['GET', 'HEAD'].includes(request.method)) return failure('tenant_writes_unavailable', 403)
        if (url.pathname.startsWith('/api/boing/github/')) {
          // GitHub's redirects cannot carry our organization selector. Their
          // state is bound to the authenticated session and server-side flow.
          if (tenant) return failure('tenant_integration_unavailable', 403)
          const callback = ['/api/boing/github/setup', '/api/boing/github/callback'].includes(url.pathname)
          const selector = callback ? null : request.headers.get('x-boing-organization')
          if (!callback && !/^[A-Za-z0-9_-]{1,128}$/.test(selector ?? '')) return failure('organization_required', 400)
          return await githubOAuth(request, env, user, selector) ?? failure('not_found', 404)
        }
        if (url.pathname === '/api/boing/invitations/accept') {
          return await acceptInvitation(request, env, user) ?? failure('not_found', 404)
        }
        const requestedSelector = request.headers.get('x-boing-organization')
        if (tenant && requestedSelector && requestedSelector !== tenant.id) return failure('organization_access_required', 403)
        const selector = tenant?.id ?? requestedSelector
        if (!selector || !/^[A-Za-z0-9_-]{1,128}$/.test(selector)) return failure('organization_required', 400)
        const response = await route(request, env, user, selector, {
          waitUntil: executionContext?.waitUntil ? promise => executionContext.waitUntil(promise) : undefined
        }) ?? failure('not_found', 404)
        if (tenant && response.ok) {
          const currentTenant = await tenantForOrigin(url, configuredEnv)
          const currentContext = await resolveContext(env, user, tenant.id)
          if (currentContext?.status === 'unavailable') return failure('service_unavailable', 503)
          if (!currentTenant || currentTenant.id !== tenant.id || currentContext?.status !== 'allowed' ||
              currentContext.organizationId !== tenant.id || currentContext.userId !== user.id ||
              currentContext.role !== tenantContext.role) return failure('organization_access_required', 403)
        }
        return response
      } catch {
        return failure('service_unavailable', 503)
      }
    }
  }
}

export default createBoingWorker()
