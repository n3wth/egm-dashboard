// The caller must establish userId from a verified session. Project IDs select
// resources; they never grant access. No method trusts a client organization ID.
const reader = "m.status='active' AND o.status='active' AND p.status='active' AND u.status='active' AND (m.role='owner' OR EXISTS (SELECT 1 FROM boing_project_memberships pm WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id))"
const editor = `${reader} AND m.role IN ('owner','admin')`
const projectJoin = `FROM boing_projects p JOIN boing_organizations o ON o.id=p.organization_id JOIN boing_memberships m ON m.organization_id=o.id JOIN boing_identities u ON u.user_id=m.user_id`

// A binding supersedes the legacy repository field, even when suspended.
// An invalidated legacy snapshot also disables fallback, preventing a removed
// binding from reviving the old repository name after an integration change.
export const visibleProjectRepository = `CASE WHEN EXISTS (SELECT 1 FROM boing_github_repositories gr
  WHERE gr.project_id=p.id AND gr.organization_id=o.id)
  THEN (SELECT gr.repository_full_name FROM boing_github_repositories gr
    JOIN boing_github_installations gi ON gi.installation_id=gr.installation_id AND gi.organization_id=gr.organization_id
    WHERE gr.project_id=p.id AND gr.organization_id=o.id AND gi.status='active')
  WHEN NOT EXISTS (SELECT 1 FROM boing_snapshot_invalidations si WHERE si.project_id=p.id)
  THEN p.repository ELSE NULL END`

export async function listProjects(db, userId, organizationId) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('verified organization scope required')
  const result = await db.prepare(`SELECT p.id,p.name,${visibleProjectRepository} AS repository,p.website_url,o.id AS organization_id,o.name AS organization_name,m.role,o.ai_enabled ${projectJoin} WHERE m.user_id=? AND o.id=? AND ${reader} ORDER BY o.name,p.name,p.id`).bind(userId, organizationId).all()
  return result.results
}

export async function projectAccess(db, userId, projectId, organizationId) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('verified organization scope required')
  return await db.prepare(`SELECT p.id,p.organization_id,p.name,${visibleProjectRepository} AS repository,p.website_url,m.role,o.ai_enabled ${projectJoin} WHERE p.id=? AND m.user_id=? AND o.id=? AND ${reader}`).bind(projectId, userId, organizationId).first()
}

export async function readProjectSnapshot(db, userId, projectId, organizationId) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('verified organization scope required')
  return await db.prepare(`SELECT s.body,s.generated_at ${projectJoin} JOIN boing_snapshots s ON s.project_id=p.id WHERE p.id=? AND m.user_id=? AND o.id=? AND ${reader} AND NOT EXISTS (SELECT 1 FROM boing_snapshot_invalidations si WHERE si.project_id=p.id)`).bind(projectId, userId, organizationId).first()
}

// Read the two independent collectors and their latest job state in one
// authorization-scoped query. An empty result means project access is denied.
// This requires JOBS_SCHEMA and deliberately does not fall back to EGM data.
export async function readProjectSources(db, userId, projectId, organizationId) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('verified organization scope required')
  const result = await db.prepare(`WITH sources(kind) AS (VALUES ('github'), ('website'))
    SELECT sources.kind, r.body, r.generated_at, j.status AS job_status, j.finished_at
    ${projectJoin} CROSS JOIN sources
    LEFT JOIN boing_source_versions sv ON sv.project_id=p.id AND sv.kind=sources.kind
      AND ((sources.kind='website' AND p.website_url IS NOT NULL AND length(trim(p.website_url))>0)
        OR (sources.kind='github' AND EXISTS (SELECT 1 FROM boing_github_repositories gr
          JOIN boing_github_installations gi ON gi.installation_id=gr.installation_id AND gi.organization_id=gr.organization_id
          WHERE gr.project_id=p.id AND gr.organization_id=o.id AND gi.status='active')))
    LEFT JOIN boing_collection_results r ON r.project_id=p.id AND r.kind=sources.kind AND r.source_revision=sv.revision
    LEFT JOIN boing_collection_jobs j ON j.id=(SELECT id FROM boing_collection_jobs
      WHERE project_id=p.id AND organization_id=o.id AND kind=sources.kind AND source_revision=sv.revision ORDER BY created_at DESC,id DESC LIMIT 1)
    WHERE p.id=? AND m.user_id=? AND o.id=? AND ${reader}
    ORDER BY sources.kind`).bind(projectId, userId, organizationId).all()
  return result.results
}

export async function readProjectPresentation(db, userId, projectId, organizationId) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('verified organization scope required')
  return await db.prepare(`SELECT s.body,s.revision,m.role ${projectJoin} JOIN boing_presentations s ON s.project_id=p.id WHERE p.id=? AND m.user_id=? AND o.id=? AND ${reader}`).bind(projectId, userId, organizationId).first()
}

// Authorization is checked in the UPDATE itself, avoiding a revocation race
// between a separate authorization lookup and a write.
export async function updateProjectPresentation(db, userId, projectId, body, revision, organizationId, binding = null) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('verified organization scope required')
  if (typeof body !== 'string' || !Number.isSafeInteger(revision) || revision < 0) throw new TypeError('invalid presentation')
  if (binding && (!['owner', 'admin'].includes(binding.role) || !binding.membershipId || !binding.membershipUpdatedAt)) throw new TypeError('invalid membership binding')
  const guard = binding ? `AND m.role=? AND EXISTS (SELECT 1 FROM boing_workos_membership_bindings b WHERE b.organization_id=o.id AND b.user_id=m.user_id AND b.workos_membership_id=? AND b.workos_updated_at=?)` : ''
  const result = await db.prepare(`UPDATE boing_presentations SET body=?,revision=revision+1 WHERE project_id=? AND revision=? AND EXISTS (SELECT 1 ${projectJoin} WHERE p.id=boing_presentations.project_id AND m.user_id=? AND o.id=? AND ${editor} ${guard})`).bind(body, projectId, revision, userId, organizationId, ...(binding ? [binding.role, binding.membershipId, binding.membershipUpdatedAt] : [])).run()
  return result.meta?.changes === 1
}

// Caller must back up and validate the legacy DB before calling. This copies
// only the currently approved EGM users once; later approvals remain manual.
// D1 batch executes the statements in a single transaction. Legacy rows stay
// untouched, allowing rollback without relying on a reverse migration.
export async function migrateLegacyEgm(db, { organizationId, projectId, ownerId, workosOrganizationId, now = new Date().toISOString() }) {
  if (![organizationId, projectId, ownerId, workosOrganizationId].every(value => typeof value === 'string' && value.trim())) throw new TypeError('migration identifiers required')
  const existing = await db.prepare("SELECT id FROM boing_migrations WHERE id='legacy-egm-v1'").first()
  if (existing) return { status: 'already_migrated' }
  const owner = await db.prepare("SELECT id FROM users WHERE id=? AND status='approved' AND verified=1").bind(ownerId).first()
  if (!owner) throw new Error('approved legacy owner required')
  const snapshot = await db.prepare('SELECT id FROM snapshots WHERE id=1').first()
  const presentation = await db.prepare('SELECT id FROM presentation WHERE id=1').first()
  if (!snapshot || !presentation) throw new Error('legacy snapshot and presentation required')
  const statements = [
    // A conflicting identity must already be active and match the legacy email;
    // a mismatch or suspension aborts the entire migration transaction.
    db.prepare("INSERT INTO boing_identities(user_id,email,status) SELECT id,email,'active' FROM users WHERE verified=1 AND status='approved' ON CONFLICT(user_id) DO UPDATE SET email=CASE WHEN boing_identities.status='active' AND lower(boing_identities.email)=lower(excluded.email) THEN boing_identities.email ELSE NULL END"),
    db.prepare("INSERT INTO boing_organizations(id,name,workos_organization_id,status,ai_enabled,created_at) VALUES(?,'EGM',?,'active',0,?)").bind(organizationId, workosOrganizationId, now),
    db.prepare("INSERT INTO boing_projects(id,organization_id,name,repository,website_url,status,created_at) VALUES(?,?,'EGM','google/elephant-goldfish-model','https://egm.dev','active',?)").bind(projectId, organizationId, now),
    db.prepare("INSERT INTO boing_memberships(organization_id,user_id,role,status,created_at) SELECT ?,id,CASE WHEN id=? THEN 'owner' ELSE 'member' END,'active',? FROM users WHERE verified=1 AND status='approved'").bind(organizationId, ownerId, now),
    db.prepare("INSERT INTO boing_project_memberships(organization_id,project_id,user_id,created_at) SELECT ?,?,id,? FROM users WHERE verified=1 AND status='approved'").bind(organizationId, projectId, now),
    db.prepare('INSERT INTO boing_snapshots(project_id,body,generated_at) SELECT ?,body,generated_at FROM snapshots WHERE id=1').bind(projectId),
    db.prepare('INSERT INTO boing_presentations(project_id,body,revision) SELECT ?,body,revision FROM presentation WHERE id=1').bind(projectId),
    db.prepare("INSERT INTO boing_migrations(id,completed_at) VALUES('legacy-egm-v1',?)").bind(now),
  ]
  await db.batch(statements)
  return { status: 'migrated' }
}
