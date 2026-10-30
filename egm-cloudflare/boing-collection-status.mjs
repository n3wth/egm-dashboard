import { resolveBoingContext } from './boing-context.mjs'
import { authorizeProjectData, recheckProjectData } from './boing-project-data-guard.mjs'

// Caller supplies the server-authenticated identity. Return only the newest
// job for each current source, without job IDs, actor IDs or provider details.
export async function readCollectionStatus(env, user, organizationId, projectId, { requestWorkos = fetch, requestGithub = fetch, now = Date.now() } = {}) {
  if (!Number.isSafeInteger(now) || now < 0) return { status: 'denied' }
  const context = await resolveBoingContext(env, user, organizationId, requestWorkos)
  if (context.status !== 'allowed') return { status: context.status }
  const access = await authorizeProjectData(env, user, context.organizationId, projectId, 'sources', { request: requestGithub })
  if (access.status !== 'allowed') return { status: access.status }
  const bound = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true'
  try {
    const read = () => env.DB.prepare(`SELECT j.kind,j.status,j.created_at,j.finished_at,j.expires_at,j.lease_expires_at
      FROM boing_collection_jobs j
      JOIN boing_source_versions v ON v.project_id=j.project_id AND v.kind=j.kind AND v.revision=j.source_revision
      JOIN boing_projects p ON p.id=j.project_id AND p.organization_id=j.organization_id
      JOIN boing_organizations o ON o.id=p.organization_id
      JOIN boing_memberships m ON m.organization_id=o.id AND m.user_id=?
      JOIN boing_identities u ON u.user_id=m.user_id
      ${bound ? 'JOIN boing_workos_membership_bindings b ON b.organization_id=m.organization_id AND b.user_id=m.user_id' : ''}
      WHERE j.organization_id=? AND j.project_id=? AND p.status='active' AND o.status='active'
        AND NOT EXISTS (SELECT 1 FROM boing_collection_jobs newer
          WHERE newer.organization_id=j.organization_id AND newer.project_id=j.project_id AND newer.kind=j.kind
            AND newer.source_revision=j.source_revision AND (newer.created_at>j.created_at OR (newer.created_at=j.created_at AND newer.id>j.id)))
        AND m.status='active' AND u.status='active' AND (m.role='owner' OR EXISTS
          (SELECT 1 FROM boing_project_memberships pm WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id))
        ${bound ? 'AND b.workos_membership_id=? AND b.workos_updated_at=?' : ''}
      ORDER BY j.created_at DESC,j.id DESC LIMIT 2`).bind(user.id, context.organizationId, projectId,
      ...(bound ? [context.membershipId, context.membershipUpdatedAt] : [])).all()
    const rows = (await read())?.results
    if (!Array.isArray(rows) || !await recheckProjectData(env, user, access.proof)) return { status: 'denied' }
    if (JSON.stringify((await read())?.results) !== JSON.stringify(rows)) return { status: 'denied' }
    const seen = new Set()
    const jobs = []
    for (const row of rows) {
      if (!['github', 'website'].includes(row.kind) || seen.has(row.kind) || !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(row.status)) continue
      seen.add(row.kind)
      const expired = (row.status === 'queued' || row.status === 'running') &&
        (row.expires_at <= now || (row.status === 'running' && row.lease_expires_at <= now))
      jobs.push({ kind: row.kind, status: expired ? 'expired' : row.status, createdAt: row.created_at, finishedAt: row.finished_at ?? null })
    }
    return { status: 'allowed', jobs }
  } catch { return { status: 'unavailable' } }
}
