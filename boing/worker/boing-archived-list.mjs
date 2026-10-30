import { resolveBoingContext } from './boing-context.mjs'

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })

// The authenticated caller supplies only a selector. No project metadata or
// stored data is returned beyond the minimum needed to identify a project.
export async function handleArchivedProjects(request, env, user, organizationId, { requestWorkos = fetch } = {}) {
  if (new URL(request.url).pathname !== '/api/boing/projects/archived') return null
  if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405)
  if (!user || user.verified !== 1 || user.status !== 'active' || !/^user_[A-Za-z0-9]+$/.test(user.id ?? '') || !/^[A-Za-z0-9_-]{1,128}$/.test(organizationId ?? '')) return reply({ error: 'access_required' }, 403)
  try {
    const original = await env.DB.prepare("SELECT workos_organization_id FROM boing_organizations WHERE id=? AND status='active'").bind(organizationId).first()
    const context = await resolveBoingContext(env, user, organizationId, requestWorkos)
    if (context.status === 'unavailable') return reply({ error: 'service_unavailable' }, 503)
    if (context.status !== 'allowed' || context.role !== 'owner' || !original?.workos_organization_id) return reply({ error: 'owner_required' }, 403)
    const result = await env.DB.prepare(`SELECT p.id,p.name FROM boing_projects p
      JOIN boing_organizations o ON o.id=p.organization_id JOIN boing_memberships m ON m.organization_id=o.id
      JOIN boing_identities i ON i.user_id=m.user_id
      WHERE o.id=? AND o.workos_organization_id=? AND o.status='active' AND p.status='archived'
      AND m.user_id=? AND m.status='active' AND m.role='owner' AND i.status='active'
      ORDER BY p.name,p.id LIMIT 101`).bind(organizationId, original.workos_organization_id, user.id).all()
    if (!Array.isArray(result?.results)) return reply({ error: 'service_unavailable' }, 503)
    return reply({ projects: result.results.slice(0, 100), truncated: result.results.length > 100 })
  } catch { return reply({ error: 'service_unavailable' }, 503) }
}
