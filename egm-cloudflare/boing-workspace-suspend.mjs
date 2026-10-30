const localId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const userId = value => typeof value === 'string' && /^user_[A-Za-z0-9]{1,120}$/.test(value)
const orgId = value => typeof value === 'string' && /^org_[A-Za-z0-9]{1,120}$/.test(value)

// Operator-only helper: do not route to HTTP or take these arguments from an
// untrusted client. Independently verify the request and scope before use.
// This restricts local access and publication; it does not delete data or
// revoke provider access, nor does it stop already dispatched provider calls.
export async function suspendWorkspace(env, { actorId, organizationId, workosOrganizationId } = {}, { now = Date.now() } = {}) {
  if (!env?.DB?.prepare || !env.DB.batch || !userId(actorId) || !localId(organizationId) || !orgId(workosOrganizationId) ||
      typeof env.BOING_PLATFORM_ADMIN_IDS !== 'string' || !env.BOING_PLATFORM_ADMIN_IDS.split(',').map(id => id.trim()).filter(userId).includes(actorId) ||
      !Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) return { status: 'denied' }
  const db = env.DB, event = crypto.randomUUID(), at = new Date(now).toISOString()
  try {
    const result = await db.batch([
      db.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
        SELECT ?,o.id,i.user_id,NULL,'workspace.suspended',? FROM boing_organizations o
        JOIN boing_identities i ON i.user_id=? AND i.status='active'
        WHERE o.id=? AND o.workos_organization_id=? AND o.status='active'`).bind(event, at, actorId, organizationId, workosOrganizationId),
      db.prepare(`UPDATE boing_organizations SET status='suspended'
        WHERE id=? AND workos_organization_id=? AND status='active'
          AND EXISTS (SELECT 1 FROM boing_audit_events WHERE id=? AND organization_id=boing_organizations.id AND actor_id=?)`)
        .bind(organizationId, workosOrganizationId, event, actorId),
      // A missing update aborts the entire transaction, including the audit.
      db.prepare(`UPDATE boing_audit_events SET action=CASE WHEN changes()=1 THEN action ELSE NULL END WHERE id=?`).bind(event),
      db.prepare(`UPDATE boing_collection_jobs SET status='cancelled',finished_at=?,claim_id=NULL,lease_expires_at=NULL
        WHERE organization_id=? AND status IN ('queued','running')
          AND EXISTS (SELECT 1 FROM boing_organizations WHERE id=? AND status='suspended')
          AND EXISTS (SELECT 1 FROM boing_audit_events WHERE id=? AND organization_id=?)`)
        .bind(at, organizationId, organizationId, event, organizationId),
    ])
    return result[0]?.meta?.changes === 1 && result[1]?.meta?.changes === 1 && result[2]?.meta?.changes === 1
      ? { status: 'suspended' } : { status: 'denied' }
  } catch { return { status: 'unavailable' } }
}
