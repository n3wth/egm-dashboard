// These helpers are not routes. The caller must authenticate the actor and
// verify current WorkOS membership before calling them. IDs select records;
// authority is established by the SQL against the owning organization. Both
// actor and target must be active Boing identities (boing_identities); the
// legacy users table is never consulted.
const ownerCheck = `EXISTS (
  SELECT 1 FROM boing_memberships actor
  JOIN boing_identities actor_user ON actor_user.user_id=actor.user_id
  WHERE actor.organization_id=p.organization_id AND actor.user_id=?
    AND actor.role='owner' AND actor.status='active'
    AND actor_user.status='active'
)`

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
}

// One INSERT SELECT checks authority and target membership in the same write.
// False includes existing grants, unauthorized actors and invalid targets.
export async function grantProjectAccess(db, actorId, projectId, targetUserId, now = new Date().toISOString()) {
  if (![actorId, projectId, targetUserId].every(validId) || typeof now !== 'string') return false
  const result = await db.prepare(`INSERT INTO boing_project_memberships(organization_id,project_id,user_id,created_at)
    SELECT p.organization_id,p.id,target.user_id,? FROM boing_projects p
    JOIN boing_organizations o ON o.id=p.organization_id
    JOIN boing_memberships target ON target.organization_id=p.organization_id AND target.user_id=?
    JOIN boing_identities target_user ON target_user.user_id=target.user_id
    WHERE p.id=? AND p.status='active' AND o.status='active'
      AND target.status='active' AND target_user.status='active'
      AND ${ownerCheck}
    ON CONFLICT(project_id,user_id) DO NOTHING`).bind(now, targetUserId, projectId, actorId).run()
  return result.meta?.changes === 1
}

// The authorization predicate is part of DELETE so a revoked owner cannot
// mutate a grant after a prior authorization check.
export async function revokeProjectAccess(db, actorId, projectId, targetUserId) {
  if (![actorId, projectId, targetUserId].every(validId)) return false
  const result = await db.prepare(`DELETE FROM boing_project_memberships
    WHERE project_id=? AND user_id=? AND EXISTS (
      SELECT 1 FROM boing_projects p JOIN boing_organizations o ON o.id=p.organization_id
      WHERE p.id=boing_project_memberships.project_id
        AND p.organization_id=boing_project_memberships.organization_id
        AND p.status='active' AND o.status='active' AND ${ownerCheck}
    )`).bind(projectId, targetUserId, actorId).run()
  return result.meta?.changes === 1
}

// Returns null when the actor is not an active owner of this project.
export async function listProjectGrants(db, actorId, projectId) {
  if (![actorId, projectId].every(validId)) return null
  const allowed = await db.prepare(`SELECT p.id FROM boing_projects p
    JOIN boing_organizations o ON o.id=p.organization_id
    WHERE p.id=? AND p.status='active' AND o.status='active' AND ${ownerCheck}`).bind(projectId, actorId).first()
  if (!allowed) return null
  // Recheck authorization in the read itself, including after the first query.
  const result = await db.prepare(`SELECT pm.user_id,pm.created_at FROM boing_project_memberships pm
    JOIN boing_projects p ON p.id=pm.project_id AND p.organization_id=pm.organization_id
    JOIN boing_organizations o ON o.id=p.organization_id
    WHERE p.id=? AND p.status='active' AND o.status='active' AND ${ownerCheck}
    ORDER BY pm.user_id`).bind(projectId, actorId).all()
  return result.results
}
