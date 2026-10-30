// Isolated staging helpers, not routes. A caller must derive actor from a
// verified session and pass the local organization ID whose WorkOS membership
// was just verified on the server. Never accept an actor, organization scope,
// or action from a client. Mutation and audit must ultimately be transactional
// before these helpers can provide a complete production audit trail.
export const AUDIT_SCHEMA = `CREATE TABLE IF NOT EXISTS boing_audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES boing_organizations(id),
  actor_id TEXT NOT NULL REFERENCES boing_identities(user_id),
  project_id TEXT,
  action TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id) REFERENCES boing_projects(organization_id, id)
);
CREATE INDEX IF NOT EXISTS boing_audit_organization_time ON boing_audit_events(organization_id, occurred_at DESC, id DESC);`

// The actor is the user object returned by authenticateBoingSession in
// boing-identity.mjs: an active Boing identity, never a legacy users row.
// Only fixed event types, identifiers and the server-generated time are stored.
// Do not store arbitrary payloads, invitation codes, emails, or provider data.
const actions = new Set(['project.created', 'project.updated', 'project.viewed', 'project.exported', 'project.access_granted', 'project.access_revoked', 'invitation.created', 'invitation.accepted', 'ai.enabled', 'ai.disabled', 'ai.insight_requested', 'integration.connected', 'integration.disconnected'])
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const validActor = actor => actor && validId(actor.id) && actor.status === 'active' && actor.verified === 1

// Scope verification and insertion occur in the same SQL statement. Project
// events additionally require current access to that specific project.
export async function recordAuditEvent(db, actor, organizationId, { projectId = null, action } = {}) {
  if (!db?.prepare || !validActor(actor) || !validId(organizationId) || (projectId !== null && !validId(projectId)) || !actions.has(action)) return false
  const id = crypto.randomUUID()
  const at = new Date().toISOString()
  const result = await db.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
    SELECT ?,o.id,m.user_id,?,?,? FROM boing_organizations o
    JOIN boing_memberships m ON m.organization_id=o.id
    JOIN boing_identities u ON u.user_id=m.user_id
    WHERE o.id=? AND o.status='active' AND m.user_id=? AND m.status='active'
      AND u.status='active'
      AND (? IS NULL OR EXISTS (
        SELECT 1 FROM boing_projects p WHERE p.id=? AND p.organization_id=o.id AND p.status='active'
          AND (m.role='owner' OR EXISTS (SELECT 1 FROM boing_project_memberships pm
            WHERE pm.organization_id=o.id AND pm.project_id=p.id AND pm.user_id=m.user_id))
      ))`).bind(id, projectId, action, at, organizationId, actor.id, projectId, projectId).run()
  return result.meta?.changes === 1
}

// An empty list also covers denied access. Authorization and event selection
// share one statement; no membership check is cached between the two.
export async function listAuditEvents(db, actor, organizationId, limit = 50) {
  if (!db?.prepare || !validActor(actor) || !validId(organizationId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return []
  const result = await db.prepare(`SELECT e.id,e.actor_id,e.project_id,e.action,e.occurred_at
    FROM boing_audit_events e JOIN boing_organizations o ON o.id=e.organization_id
    JOIN boing_memberships m ON m.organization_id=o.id JOIN boing_identities u ON u.user_id=m.user_id
    WHERE e.organization_id=? AND o.status='active' AND m.user_id=? AND m.role='owner'
      AND m.status='active' AND u.status='active'
    ORDER BY e.occurred_at DESC,e.id DESC LIMIT ?`).bind(organizationId, actor.id, limit).all()
  return result.results
}
