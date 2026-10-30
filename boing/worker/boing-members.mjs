import { resolveBoingContext } from './boing-context.mjs'
import { verifyWorkosMembership } from './boing-workos.mjs'

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const response = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
const owner = `EXISTS (SELECT 1 FROM boing_memberships actor JOIN boing_identities identity ON identity.user_id=actor.user_id
  JOIN boing_organizations org ON org.id=actor.organization_id
  WHERE actor.organization_id=? AND actor.user_id=? AND actor.role='owner' AND actor.status='active'
  AND identity.status='active' AND org.status='active' AND org.workos_organization_id=?)`

// Called only after authenticating the session. The organization is a selector,
// not authority: WorkOS and the local owner grant are rechecked here.
export async function handleBoingMembers(request, env, user, organizationId, { requestWorkos = fetch } = {}) {
  const path = new URL(request.url).pathname
  const members = path === '/api/boing/members'
  const match = /^\/api\/boing\/projects\/([A-Za-z0-9_-]{1,128})\/access$/.exec(path)
  if (!members && !match) return null
  if (!validId(organizationId) || !user || user.verified !== 1 || user.status !== 'active') return response({ error: 'access_required' }, 403)
  try {
    const before = await env.DB.prepare('SELECT workos_organization_id FROM boing_organizations WHERE id=? AND status=\'active\'').bind(organizationId).first()
    const context = await resolveBoingContext(env, user, organizationId, requestWorkos)
    if (context.status === 'unavailable') return response({ error: 'service_unavailable' }, 503)
    if (context.status !== 'allowed' || context.role !== 'owner' || !before?.workos_organization_id) return response({ error: 'owner_required' }, 403)
    const binding = [organizationId, user.id, before.workos_organization_id]
    if (members) {
      if (request.method !== 'GET') return response({ error: 'method_not_allowed' }, 405)
      const rows = await env.DB.prepare(`SELECT m.user_id, i.email, m.role FROM boing_memberships m
        JOIN boing_identities i ON i.user_id=m.user_id
        WHERE m.organization_id=? AND m.status='active' AND i.status='active' AND ${owner}
        ORDER BY i.email, m.user_id LIMIT 101`).bind(organizationId, ...binding).all()
      return response({ members: rows.results.slice(0, 100), truncated: rows.results.length > 100 })
    }
    const projectId = match[1]
    if (request.method === 'GET') {
      const project = await env.DB.prepare(`SELECT p.id FROM boing_projects p WHERE p.id=? AND p.organization_id=? AND p.status='active' AND ${owner}`).bind(projectId, organizationId, ...binding).first()
      if (!project) return response({ error: 'not_found' }, 404)
      const rows = await env.DB.prepare(`SELECT pm.user_id FROM boing_project_memberships pm JOIN boing_memberships m
        ON m.organization_id=pm.organization_id AND m.user_id=pm.user_id
        JOIN boing_identities i ON i.user_id=m.user_id JOIN boing_projects p ON p.id=pm.project_id AND p.organization_id=pm.organization_id
        WHERE pm.project_id=? AND pm.organization_id=? AND p.status='active' AND m.status='active' AND i.status='active' AND ${owner}
        ORDER BY pm.user_id LIMIT 101`).bind(projectId, organizationId, ...binding).all()
      return response({ userIds: rows.results.slice(0, 100).map(row => row.user_id), truncated: rows.results.length > 100 })
    }
    if (request.method !== 'PUT') return response({ error: 'method_not_allowed' }, 405)
    if (new URL(request.url).origin !== env.APP_URL || request.headers.get('origin') !== env.APP_URL) return response({ error: 'invalid_origin' }, 403)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return response({ error: 'json_required' }, 415)
    if (Number(request.headers.get('content-length')) > 1024) return response({ error: 'too_large' }, 413)
    const reader = request.body?.getReader()
    if (!reader) return response({ error: 'invalid_request' }, 400)
    let bytes = 0, body = ''
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true })
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 1024) { await reader.cancel(); return response({ error: 'too_large' }, 413) }
        body += decoder.decode(value, { stream: true })
      }
      body += decoder.decode()
    } finally { reader.releaseLock() }
    let input
    try { input = JSON.parse(body) } catch { return response({ error: 'invalid_request' }, 400) }
    if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'enabled,userId' || !/^user_[A-Za-z0-9]+$/.test(input.userId ?? '') || typeof input.enabled !== 'boolean') return response({ error: 'invalid_request' }, 400)
    let targetVersion
    if (input.enabled) {
      // Never create access for a target whose current WorkOS membership is absent.
      const target = await resolveBoingContext(env, { id: input.userId, status: 'active', verified: 1 }, organizationId, requestWorkos)
      if (target.status === 'unavailable') return response({ error: 'service_unavailable' }, 503)
      if (target.status !== 'allowed' || target.role === 'owner') return response({ error: 'target_unavailable' }, 404)
      if (env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true') {
        targetVersion = await verifyWorkosMembership(env, { id: input.userId, status: 'active', verified: 1 }, before.workos_organization_id, requestWorkos)
        if (targetVersion.status !== 'allowed') return response({ error: targetVersion.status === 'unavailable' ? 'service_unavailable' : 'target_unavailable' }, targetVersion.status === 'unavailable' ? 503 : 404)
      }
    }
    // The target lookup awaits WorkOS. Recheck the actor after it, then bind
    // the exact provider version to the local row inside the write itself.
    const actorVersion = await verifyWorkosMembership(env, user, before.workos_organization_id, requestWorkos)
    if (actorVersion.status !== 'allowed') return response({ error: actorVersion.status === 'unavailable' ? 'service_unavailable' : 'owner_required' }, actorVersion.status === 'unavailable' ? 503 : 403)
    const actorVersionSql = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true'
      ? ' AND EXISTS (SELECT 1 FROM boing_workos_membership_bindings b WHERE b.organization_id=? AND b.user_id=? AND b.workos_membership_id=? AND b.workos_updated_at=?)' : ''
    const actorVersionArgs = actorVersionSql ? [organizationId, user.id, actorVersion.membershipId, actorVersion.updatedAt] : []
    if (input.enabled) {
      const targetVersionSql = targetVersion ? ' AND EXISTS (SELECT 1 FROM boing_workos_membership_bindings b WHERE b.organization_id=m.organization_id AND b.user_id=m.user_id AND b.workos_membership_id=? AND b.workos_updated_at=?)' : ''
      const auditId = crypto.randomUUID(), now = new Date().toISOString()
      const [result] = await env.DB.batch([env.DB.prepare(`INSERT INTO boing_project_memberships(organization_id,project_id,user_id,created_at)
        SELECT p.organization_id,p.id,m.user_id,? FROM boing_projects p
        JOIN boing_memberships m ON m.organization_id=p.organization_id AND m.user_id=?
        JOIN boing_identities i ON i.user_id=m.user_id
        WHERE p.id=? AND p.organization_id=? AND p.status='active' AND m.status='active' AND m.role<>'owner' AND i.status='active' AND ${owner}${actorVersionSql}${targetVersionSql}
        ON CONFLICT(project_id,user_id) DO NOTHING`).bind(now, input.userId, projectId, organizationId, ...binding, ...actorVersionArgs, ...(targetVersion ? [targetVersion.membershipId, targetVersion.updatedAt] : [])),
      env.DB.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
        SELECT ?,?,?,?,'project.access_granted',? WHERE changes()=1`).bind(auditId, organizationId, user.id, projectId, now)])
      if (result.meta?.changes !== 1) return response({ error: 'target_unavailable' }, 404)
    } else {
      const [result] = await env.DB.batch([env.DB.prepare(`DELETE FROM boing_project_memberships WHERE project_id=? AND organization_id=? AND user_id=?
        AND EXISTS (SELECT 1 FROM boing_projects p WHERE p.id=boing_project_memberships.project_id AND p.organization_id=? AND p.status='active') AND ${owner}${actorVersionSql}`)
        .bind(projectId, organizationId, input.userId, organizationId, ...binding, ...actorVersionArgs),
      env.DB.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
        SELECT ?,?,?,?,'project.access_revoked',? WHERE changes()=1`).bind(crypto.randomUUID(), organizationId, user.id, projectId, new Date().toISOString())])
      if (result.meta?.changes !== 1) return response({ error: 'target_unavailable' }, 404)
    }
    return response({ updated: true })
  } catch { return response({ error: 'service_unavailable' }, 503) }
}
