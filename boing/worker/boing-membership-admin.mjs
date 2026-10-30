import { resolveBoingContext } from './boing-context.mjs'

// Additive schema for recording the target without putting personal data in
// audit action names. Apply alongside the existing audit schema.
export const BOING_MEMBERSHIP_AUDIT_SCHEMA = `CREATE TABLE IF NOT EXISTS boing_membership_audit_targets (
  event_id TEXT PRIMARY KEY REFERENCES boing_audit_events(id),
  target_user_id TEXT NOT NULL REFERENCES boing_identities(user_id)
);`

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

// This suspends only Boing's local membership. The identity-provider account
// and its other workspaces are not changed. User and organization scope come
// from the authenticated Worker and are freshly verified against WorkOS.
export async function handleMembershipRevocation(request, env, user, organizationId, { requestWorkos = fetch, now = Date.now() } = {}) {
  const match = /^\/api\/boing\/members\/(user_[A-Za-z0-9]+)\/revoke$/.exec(new URL(request.url).pathname)
  if (!match) return null
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)
  if (!env?.APP_URL || new URL(request.url).origin !== env.APP_URL || request.headers.get('origin') !== env.APP_URL) return reply({ error: 'invalid_origin' }, 403)
  if (!user || user.verified !== 1 || user.status !== 'active' || !/^user_[A-Za-z0-9]+$/.test(user.id ?? '') || !validId(organizationId)) return reply({ error: 'access_required' }, 403)
  if (match[1] === user.id) return reply({ error: 'cannot_remove_self' }, 409)
  if (!env?.DB?.prepare || !env.DB.batch || !Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) return reply({ error: 'service_unavailable' }, 503)
  try {
    const original = await env.DB.prepare('SELECT workos_organization_id FROM boing_organizations WHERE id=? AND status=\'active\'').bind(organizationId).first()
    const context = await resolveBoingContext(env, user, organizationId, requestWorkos)
    if (context.status === 'unavailable') return reply({ error: 'service_unavailable' }, 503)
    if (context.status !== 'allowed' || context.role !== 'owner' || !original?.workos_organization_id) return reply({ error: 'owner_required' }, 403)
    const bindingRequired = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true'
    if (bindingRequired) {
      const current = await resolveBoingContext(env, user, organizationId, requestWorkos)
      if (current.status === 'unavailable') return reply({ error: 'service_unavailable' }, 503)
      if (current.status !== 'allowed' || current.role !== context.role || current.organizationId !== context.organizationId ||
          current.userId !== context.userId || current.membershipId !== context.membershipId ||
          current.membershipUpdatedAt !== context.membershipUpdatedAt) return reply({ error: 'owner_required' }, 403)
    }
    const bindingCheck = `EXISTS (SELECT 1 FROM boing_workos_membership_bindings b
      JOIN boing_memberships m ON m.organization_id=b.organization_id AND m.user_id=b.user_id
      JOIN boing_identities i ON i.user_id=m.user_id JOIN boing_organizations o ON o.id=m.organization_id
      WHERE b.organization_id=? AND b.user_id=? AND b.workos_membership_id=? AND b.workos_updated_at=?
        AND m.role='owner' AND m.status='active' AND i.status='active' AND o.status='active' AND o.workos_organization_id=?)`
    const bindingArgs = [organizationId, user.id, context.membershipId, context.membershipUpdatedAt, original.workos_organization_id]
    const event = crypto.randomUUID()
    const stamp = new Date(now).toISOString()
    const result = await env.DB.batch([
      env.DB.prepare(`UPDATE boing_memberships SET status='suspended'
        WHERE organization_id=? AND user_id=? AND status='active' AND user_id<>?
          AND EXISTS (SELECT 1 FROM boing_organizations o JOIN boing_memberships actor ON actor.organization_id=o.id
            JOIN boing_identities i ON i.user_id=actor.user_id
            WHERE o.id=boing_memberships.organization_id AND o.status='active' AND o.workos_organization_id=?
              AND actor.user_id=? AND actor.status='active' AND actor.role='owner' AND i.status='active')${bindingRequired ? ` AND ${bindingCheck}` : ''}`)
        .bind(organizationId, match[1], user.id, original.workos_organization_id, user.id, ...(bindingRequired ? bindingArgs : [])),
      bindingRequired ? env.DB.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
        VALUES(?,CASE WHEN changes()=1 AND ${bindingCheck} THEN ? ELSE NULL END,?,NULL,'membership.revoked',?)`).bind(event, ...bindingArgs, organizationId, user.id, stamp)
        : env.DB.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
        SELECT ?,?,?,NULL,'membership.revoked',? WHERE changes()=1`).bind(event, organizationId, user.id, stamp),
      bindingRequired ? env.DB.prepare(`INSERT INTO boing_membership_audit_targets(event_id,target_user_id)
        VALUES(CASE WHEN changes()=1 AND ${bindingCheck} THEN ? ELSE NULL END,?)`).bind(...bindingArgs, event, match[1])
        : env.DB.prepare('INSERT INTO boing_membership_audit_targets(event_id,target_user_id) SELECT ?,? WHERE changes()=1').bind(event, match[1]),
      env.DB.prepare(`DELETE FROM boing_project_memberships WHERE organization_id=? AND user_id=?
        AND EXISTS (SELECT 1 FROM boing_membership_audit_targets WHERE event_id=?)`).bind(organizationId, match[1], event),
    ])
    if (result[0]?.meta?.changes !== 1 || result[1]?.meta?.changes !== 1 || result[2]?.meta?.changes !== 1) return reply({ error: 'member_unavailable' }, 404)
    return reply({ revoked: true, providerMembershipUnchanged: true })
  } catch { return reply({ error: 'service_unavailable' }, 503) }
}
