import { readVerifiedWorkosEmail } from './workos-identity.mjs'
import { verifyWorkosMembership } from './boing-workos.mjs'

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
const userId = value => typeof value === 'string' && /^user_[A-Za-z0-9]{1,120}$/.test(value)
const orgId = value => typeof value === 'string' && /^org_[A-Za-z0-9]{1,120}$/.test(value)
const email = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : null

async function boundedJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') || !request.body) return null
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0, raw = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4096) { await reader.cancel(); return null }
      raw += decoder.decode(value, { stream: true })
    }
    return JSON.parse(raw + decoder.decode())
  } catch { return null } finally { reader.releaseLock() }
}

// Isolated staging operation. This never creates WorkOS users or memberships,
// sends email, or reactivates a suspended local identity. The caller must pass
// a freshly authenticated Boing session, and route it outside tenant selectors.
// A server-controlled user-ID allowlist is required; never accept admin status
// from request data. Production provisioning remains disabled by design.
export async function handlePlatformProvision(request, env, actor, { requestWorkos = fetch, now = Date.now() } = {}) {
  if (new URL(request.url).pathname !== '/api/boing/platform/workspaces') return null
  if (!['GET', 'POST'].includes(request.method)) return reply({ error: 'method_not_allowed' }, 405)
  if (env?.BOING_ENVIRONMENT !== 'staging' || env.BOING_PLATFORM_PROVISIONING_ENABLED !== 'true') return reply({ error: 'unavailable' }, 503)
  if (!env.APP_URL || new URL(request.url).origin !== env.APP_URL || (request.method === 'POST' && request.headers.get('origin') !== env.APP_URL)) return reply({ error: 'invalid_origin' }, 403)
  if (!actor || actor.verified !== 1 || actor.status !== 'active' || !userId(actor.id) ||
      typeof env.BOING_PLATFORM_ADMIN_IDS !== 'string' || !env.BOING_PLATFORM_ADMIN_IDS.split(',').map(id => id.trim()).filter(userId).includes(actor.id)) return reply({ error: 'forbidden' }, 403)
  if (!env.DB?.prepare || !env.DB?.batch || !Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) return reply({ error: 'unavailable' }, 503)
  if (request.method === 'GET') {
    try {
      const local = await env.DB.prepare("SELECT user_id FROM boing_identities WHERE user_id=? AND status='active'").bind(actor.id).first()
      return local ? reply({ available: true }) : reply({ error: 'forbidden' }, 403)
    } catch { return reply({ error: 'unavailable' }, 503) }
  }
  const input = await boundedJson(request)
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'name,ownerEmail,ownerUserId,workosOrganizationId' ||
      typeof input.name !== 'string' || input.name.trim() !== input.name || !input.name || input.name.length > 100 || /[\u0000-\u001f\u007f]/.test(input.name) ||
      !userId(input.ownerUserId) || !orgId(input.workosOrganizationId) || !email(input.ownerEmail)) return reply({ error: 'invalid_request' }, 400)
  try {
    const localActor = await env.DB.prepare("SELECT user_id FROM boing_identities WHERE user_id=? AND status='active'").bind(actor.id).first()
    if (!localActor) return reply({ error: 'forbidden' }, 403)
    const verifiedEmail = await readVerifiedWorkosEmail(env, input.ownerUserId, requestWorkos)
    if (!verifiedEmail || verifiedEmail !== email(input.ownerEmail)) return reply({ error: 'owner_unavailable' }, 403)
    const target = { id: input.ownerUserId, status: 'active', verified: 1 }
    const membership = await verifyWorkosMembership(env, target, input.workosOrganizationId, requestWorkos)
    if (membership.status !== 'allowed') return reply({ error: membership.status === 'unavailable' ? 'unavailable' : 'owner_unavailable' }, membership.status === 'unavailable' ? 503 : 403)
    if (env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' && (!/^om_[A-Za-z0-9]+$/.test(membership.membershipId ?? '') || typeof membership.updatedAt !== 'string' || !Number.isFinite(Date.parse(membership.updatedAt)))) return reply({ error: 'owner_unavailable' }, 403)
    const id = crypto.randomUUID(), stamp = new Date(now).toISOString()
    const statements = [
      env.DB.prepare(`INSERT INTO boing_organizations(id,name,workos_organization_id,status,ai_enabled,created_at)
        SELECT ?,?,?,'active',0,? WHERE EXISTS (SELECT 1 FROM boing_identities WHERE user_id=? AND status='active')
        AND (SELECT COUNT(*) FROM boing_organizations)<100`).bind(id, input.name, input.workosOrganizationId, stamp, actor.id),
      env.DB.prepare("INSERT INTO boing_identities(user_id,email,status) VALUES(?,?,'active') ON CONFLICT(user_id) DO NOTHING").bind(input.ownerUserId, verifiedEmail),
      // NULL role violates NOT NULL, aborting the entire D1 batch on conflict,
      // missing actor, quota denial, or a suspended/mismatched owner identity.
      env.DB.prepare(`INSERT INTO boing_memberships(organization_id,user_id,role,status,created_at)
        VALUES(?,?,CASE WHEN EXISTS (SELECT 1 FROM boing_organizations o JOIN boing_identities owner ON owner.user_id=?
          JOIN boing_identities admin ON admin.user_id=? WHERE o.id=? AND o.workos_organization_id=?
          AND o.status='active' AND owner.status='active' AND lower(owner.email)=? AND admin.status='active')
          THEN 'owner' ELSE NULL END,'active',?)`).bind(id, input.ownerUserId, input.ownerUserId, actor.id, id, input.workosOrganizationId, verifiedEmail, stamp),
      env.DB.prepare("INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at) VALUES(?,?,?,NULL,'workspace.created',?)").bind(crypto.randomUUID(), id, actor.id, stamp),
    ]
    if (env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true') {
      statements.push(env.DB.prepare('INSERT INTO boing_workos_membership_bindings(organization_id,user_id,workos_membership_id,workos_updated_at) VALUES(?,?,?,?)')
        .bind(id, input.ownerUserId, membership.membershipId, membership.updatedAt))
    }
    const result = await env.DB.batch(statements)
    if (result[0]?.meta?.changes !== 1 || result[2]?.meta?.changes !== 1 || result[3]?.meta?.changes !== 1 || (env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' && result[4]?.meta?.changes !== 1)) return reply({ error: 'unavailable' }, 503)
    return reply({ workspace: { id, name: input.name } }, 201)
  } catch { return reply({ error: 'unavailable' }, 503) }
}
