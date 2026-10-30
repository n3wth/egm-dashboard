import { resolveBoingContext } from './boing-context.mjs'

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })

// Archive is a restriction step, not deletion. Data, provider installation,
// historical backups and audit events remain. Restore preserves invalidations
// and cancelled jobs; old source data is not reactivated. Only a verified
// workspace owner may mutate the project, rechecked in the same transaction.
export async function handleProjectArchive(request, env, user, organizationId, { requestWorkos = fetch, now = Date.now() } = {}) {
  const match = /^\/api\/boing\/projects\/([A-Za-z0-9_-]{1,128})\/(archive|restore)$/.exec(new URL(request.url).pathname)
  if (!match) return null
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)
  if (!env?.APP_URL || new URL(request.url).origin !== env.APP_URL || request.headers.get('origin') !== env.APP_URL) return reply({ error: 'invalid_origin' }, 403)
  if (!user || user.status !== 'active' || user.verified !== 1 || !/^user_[A-Za-z0-9]+$/.test(user.id ?? '') || !validId(organizationId)) return reply({ error: 'access_required' }, 403)
  if (!env?.DB?.prepare || !env.DB.batch || !Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) return reply({ error: 'service_unavailable' }, 503)
  try {
    const original = await env.DB.prepare("SELECT workos_organization_id FROM boing_organizations WHERE id=? AND status='active'").bind(organizationId).first()
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
    const projectId = match[1], event = crypto.randomUUID(), stamp = new Date(now).toISOString()
    if (match[2] === 'restore') {
      const result = await env.DB.batch([
        env.DB.prepare(`UPDATE boing_projects SET status='active' WHERE id=? AND organization_id=? AND status='archived'
          AND EXISTS (SELECT 1 FROM boing_organizations o JOIN boing_memberships m ON m.organization_id=o.id
            JOIN boing_identities i ON i.user_id=m.user_id
            WHERE o.id=boing_projects.organization_id AND o.status='active' AND o.workos_organization_id=?
              AND m.user_id=? AND m.status='active' AND m.role='owner' AND i.status='active')
          AND EXISTS (SELECT 1 FROM boing_snapshot_invalidations si WHERE si.project_id=boing_projects.id)
          AND EXISTS (SELECT 1 FROM boing_audit_events ae WHERE ae.organization_id=boing_projects.organization_id AND ae.project_id=boing_projects.id AND ae.action='project.archived')
          AND NOT EXISTS (SELECT 1 FROM boing_collection_results r JOIN boing_source_versions v ON v.project_id=r.project_id AND v.kind=r.kind AND v.revision=r.source_revision WHERE r.project_id=boing_projects.id)
          AND NOT EXISTS (SELECT 1 FROM boing_collection_jobs j WHERE j.project_id=boing_projects.id AND j.status IN ('queued','running'))${bindingRequired ? ` AND ${bindingCheck}` : ''}`)
          .bind(projectId, organizationId, original.workos_organization_id, user.id, ...(bindingRequired ? bindingArgs : [])),
        bindingRequired ? env.DB.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
          VALUES(?,CASE WHEN changes()=1 AND ${bindingCheck} THEN ? ELSE NULL END,?,?,'project.restored',?)`).bind(event, ...bindingArgs, organizationId, user.id, projectId, stamp)
          : env.DB.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
          SELECT ?,?,?,?,'project.restored',? WHERE changes()=1`).bind(event, organizationId, user.id, projectId, stamp),
      ])
      if (result[0]?.meta?.changes !== 1 || result[1]?.meta?.changes !== 1) return reply({ error: 'project_unavailable' }, 404)
      return reply({ restored: true, previousDataRestored: false })
    }
    const result = await env.DB.batch([
      env.DB.prepare(`UPDATE boing_projects SET status='archived' WHERE id=? AND organization_id=? AND status='active'
        AND EXISTS (SELECT 1 FROM boing_organizations o JOIN boing_memberships m ON m.organization_id=o.id
          JOIN boing_identities i ON i.user_id=m.user_id
          WHERE o.id=boing_projects.organization_id AND o.status='active' AND o.workos_organization_id=?
            AND m.user_id=? AND m.status='active' AND m.role='owner' AND i.status='active')${bindingRequired ? ` AND ${bindingCheck}` : ''}`)
        .bind(projectId, organizationId, original.workos_organization_id, user.id, ...(bindingRequired ? bindingArgs : [])),
      bindingRequired ? env.DB.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
        VALUES(?,CASE WHEN changes()=1 AND ${bindingCheck} THEN ? ELSE NULL END,?,?,'project.archived',?)`).bind(event, ...bindingArgs, organizationId, user.id, projectId, stamp)
        : env.DB.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
        SELECT ?,?,?,?,'project.archived',? WHERE changes()=1`).bind(event, organizationId, user.id, projectId, stamp),
      env.DB.prepare(`UPDATE boing_collection_jobs SET status='cancelled',finished_at=?,claim_id=NULL,lease_expires_at=NULL
        WHERE organization_id=? AND project_id=? AND status IN ('queued','running')
        AND EXISTS (SELECT 1 FROM boing_audit_events WHERE id=?)`).bind(stamp, organizationId, projectId, event),
      env.DB.prepare(`UPDATE boing_source_versions SET revision=revision+1 WHERE project_id=?
        AND EXISTS (SELECT 1 FROM boing_audit_events WHERE id=?)`).bind(projectId, event),
      env.DB.prepare(`INSERT INTO boing_snapshot_invalidations(project_id)
        SELECT ? WHERE EXISTS (SELECT 1 FROM boing_audit_events WHERE id=?) ON CONFLICT(project_id) DO NOTHING`).bind(projectId, event),
    ])
    if (result[0]?.meta?.changes !== 1 || result[1]?.meta?.changes !== 1) return reply({ error: 'project_unavailable' }, 404)
    return reply({ archived: true, dataDeleted: false })
  } catch { return reply({ error: 'service_unavailable' }, 503) }
}
