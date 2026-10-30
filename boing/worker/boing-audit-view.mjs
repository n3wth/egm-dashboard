import { resolveBoingContext } from './boing-context.mjs'

const reply = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })

// The workspace header selects a workspace; it does not grant access.
export async function handleBoingAuditView(request, env, user, organizationId, { requestWorkos = fetch } = {}) {
  if (new URL(request.url).pathname !== '/api/boing/audit') return null
  if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405)
  try {
    const mapping = await env.DB.prepare("SELECT workos_organization_id FROM boing_organizations WHERE id=? AND status='active'").bind(organizationId).first()
    const access = await resolveBoingContext(env, user, organizationId, requestWorkos)
    if (access.status === 'unavailable') return reply({ error: 'service_unavailable' }, 503)
    if (access.status !== 'allowed' || access.role !== 'owner' || !mapping?.workos_organization_id) return reply({ error: 'owner_required' }, 403)
    const rows = await env.DB.prepare(`SELECT e.action, e.actor_id, e.project_id, e.occurred_at
      FROM boing_audit_events e WHERE e.organization_id=? AND EXISTS (
        SELECT 1 FROM boing_memberships m JOIN boing_identities i ON i.user_id=m.user_id
        JOIN boing_organizations o ON o.id=m.organization_id
        WHERE m.organization_id=? AND m.user_id=? AND m.role='owner' AND m.status='active'
          AND i.status='active' AND o.status='active' AND o.workos_organization_id=?
      ) ORDER BY e.occurred_at DESC, e.id DESC LIMIT 51`).bind(organizationId, organizationId, user.id, mapping.workos_organization_id).all()
    const final = await resolveBoingContext(env, user, organizationId, requestWorkos)
    if (final.status === 'unavailable') return reply({ error: 'service_unavailable' }, 503)
    const current = await env.DB.prepare("SELECT workos_organization_id FROM boing_organizations WHERE id=? AND status='active'").bind(organizationId).first()
    if (final.status !== 'allowed' || final.role !== 'owner' || current?.workos_organization_id !== mapping.workos_organization_id) return reply({ error: 'owner_required' }, 403)
    return reply({ events: rows.results.slice(0, 50), truncated: rows.results.length > 50 })
  } catch { return reply({ error: 'service_unavailable' }, 503) }
}
