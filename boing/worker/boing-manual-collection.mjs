import { collectionReadiness } from './boing-collection-config.mjs'
import { collectionAdmissionLimit, collectionWindowCutoff } from './boing-jobs.mjs'

// Server-only admission primitive. `context` must be freshly resolved from a
// verified session, never from request JSON. This does not dispatch jobs.
// The scheduler or an explicitly bounded runner must execute accepted jobs.
export async function admitManualCollection(env, context, projectId, now = Date.now()) {
  const valid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
  if (env?.BOING_COLLECTION_ENABLED !== 'true') return { status: 'disabled', admitted: [] }
  if (!env?.DB?.prepare || env.BOING_MEMBERSHIP_BINDING_REQUIRED !== 'true' || context?.status !== 'allowed' ||
      context.role !== 'owner' || !valid(context.organizationId) || !valid(projectId) ||
      !/^user_[A-Za-z0-9]+$/.test(context.userId ?? '') || !/^om_[A-Za-z0-9]+$/.test(context.membershipId ?? '') ||
      typeof context.membershipUpdatedAt !== 'string' || !context.membershipUpdatedAt ||
      !Number.isSafeInteger(now) || now < 3_600_000 || now > 8_640_000_000_000_000 - 900_000) return { status: 'denied', admitted: [] }
  const configured = await collectionReadiness(env)
  const admitted = []
  try {
    for (const kind of ['github', 'website']) {
      if (!configured[kind]) continue
      const id = crypto.randomUUID()
      const result = await env.DB.prepare(`INSERT INTO boing_collection_jobs
        (id,organization_id,project_id,actor_id,kind,source_revision,status,created_at,expires_at)
        SELECT ?,o.id,p.id,m.user_id,v.kind,v.revision,'queued',?,? FROM boing_projects p
        JOIN boing_organizations o ON o.id=p.organization_id
        JOIN boing_memberships m ON m.organization_id=o.id
        JOIN boing_identities u ON u.user_id=m.user_id
        JOIN boing_workos_membership_bindings b ON b.organization_id=m.organization_id AND b.user_id=m.user_id
        JOIN boing_source_versions v ON v.project_id=p.id AND v.kind=?
        WHERE o.id=? AND p.id=? AND o.status='active' AND p.status='active'
          AND m.user_id=? AND m.role='owner' AND m.status='active' AND u.status='active'
          AND b.workos_membership_id=? AND b.workos_updated_at=?
          AND ((v.kind='website' AND p.website_url IS NOT NULL AND p.website_url<>'') OR
            (v.kind='github' AND EXISTS (SELECT 1 FROM boing_github_repositories r
              JOIN boing_github_installations i ON i.organization_id=r.organization_id AND i.installation_id=r.installation_id
              WHERE r.project_id=p.id AND r.organization_id=o.id AND i.status='active')))
          AND NOT EXISTS (SELECT 1 FROM boing_collection_jobs j WHERE j.project_id=p.id AND j.kind=v.kind
            AND (j.created_at>? OR (j.status IN ('queued','running') AND j.expires_at>?)))
          ${collectionAdmissionLimit}`)
        .bind(id, new Date(now).toISOString(), now + 900_000, kind, context.organizationId, projectId,
          context.userId, context.membershipId, context.membershipUpdatedAt, new Date(now - 3_600_000).toISOString(), now,
          collectionWindowCutoff(now), collectionWindowCutoff(now)).run()
      if (result.meta?.changes === 1) admitted.push({ kind, id })
    }
    return { status: admitted.length ? 'queued' : 'not_queued', admitted }
  } catch {
    // A partial admission may already have committed; never hide its IDs from
    // the trusted caller, which must not retry it as if nothing happened.
    return { status: 'unavailable', admitted }
  }
}
