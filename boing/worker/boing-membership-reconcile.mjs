import { readVerifiedWorkosEmail } from '../../egm-cloudflare/workos-identity.mjs'
import { verifyWorkosMembership } from './boing-workos.mjs'

const localId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const userId = value => typeof value === 'string' && /^user_[A-Za-z0-9]{1,120}$/.test(value)
const orgId = value => typeof value === 'string' && /^org_[A-Za-z0-9]{1,120}$/.test(value)
const membershipId = value => typeof value === 'string' && /^om_[A-Za-z0-9]{1,120}$/.test(value)
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) && Number.isFinite(Date.parse(value))

// Trusted operator-only workflow. Never route this helper to HTTP or accept
// the actor, approved versions, provider transport, or clock from a client.
// The operator must review and explicitly supply both the old and new grant
// versions, scope, role, and verified recipient email. This cannot revoke an
// in-flight provider change or make WorkOS and D1 a single transaction.
export async function reconcileMembershipBinding(env, { actorId, organizationId, userId: targetId, workosOrganizationId, role, email, previous, approved } = {}, { request = fetch, now = Date.now() } = {}) {
  if (!env?.DB?.prepare || !env.DB.batch || !userId(actorId) || !localId(organizationId) || !userId(targetId) || !orgId(workosOrganizationId) ||
      !['owner', 'admin', 'member'].includes(role) || typeof email !== 'string' || email !== email.trim().toLowerCase() || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !membershipId(previous?.membershipId) || !timestamp(previous?.updatedAt) || !membershipId(approved?.membershipId) || !timestamp(approved?.updatedAt) ||
      (previous.membershipId === approved.membershipId && previous.updatedAt === approved.updatedAt) ||
      !Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000 || typeof request !== 'function') return { status: 'denied' }
  const db = env.DB
  const lookup = () => db.prepare(`SELECT o.workos_organization_id, m.role, i.email, b.workos_membership_id, b.workos_updated_at
    FROM boing_memberships m JOIN boing_organizations o ON o.id=m.organization_id
    JOIN boing_identities i ON i.user_id=m.user_id
    JOIN boing_workos_membership_bindings b ON b.organization_id=m.organization_id AND b.user_id=m.user_id
    JOIN boing_identities actor ON actor.user_id=? AND actor.status='active'
    WHERE o.id=? AND m.user_id=? AND o.status='active' AND m.status='active' AND i.status='active'
      AND NOT EXISTS (SELECT 1 FROM boing_identities other WHERE other.user_id<>i.user_id AND lower(other.email)=lower(i.email))`)
    .bind(actorId, organizationId, targetId).first()
  const matches = row => row && row.workos_organization_id === workosOrganizationId && row.role === role && row.email.toLowerCase() === email && row.workos_membership_id === previous.membershipId && row.workos_updated_at === previous.updatedAt
  try {
    if (!matches(await lookup())) return { status: 'denied' }
    const target = { id: targetId, verified: 1, status: 'active' }
    const verify = async () => {
      const [verifiedEmail, member] = await Promise.all([
        readVerifiedWorkosEmail(env, targetId, request),
        verifyWorkosMembership({ ...env, BOING_MEMBERSHIP_BINDING_REQUIRED: 'true' }, target, workosOrganizationId, request),
      ])
      if (member.status === 'unavailable') return 'unavailable'
      return verifiedEmail === email && member.status === 'allowed' && member.membershipId === approved.membershipId && member.updatedAt === approved.updatedAt ? 'allowed' : 'denied'
    }
    const checked = await verify()
    if (checked !== 'allowed') return { status: checked }
    if (!matches(await lookup())) return { status: 'denied' }
    const checkedAgain = await verify()
    if (checkedAgain !== 'allowed') return { status: checkedAgain }
    const eventId = crypto.randomUUID(), occurredAt = new Date(now).toISOString()
    // D1 batch statements run in one transaction. A failed compare inserts a
    // NULL action, which violates NOT NULL and rolls back the entire batch.
    const guard = `EXISTS (SELECT 1 FROM boing_memberships m JOIN boing_organizations o ON o.id=m.organization_id
      JOIN boing_identities i ON i.user_id=m.user_id JOIN boing_workos_membership_bindings b ON b.organization_id=m.organization_id AND b.user_id=m.user_id
      JOIN boing_identities actor ON actor.user_id=? AND actor.status='active'
      WHERE o.id=? AND o.workos_organization_id=? AND o.status='active' AND m.user_id=? AND m.role=? AND m.status='active'
        AND i.status='active' AND lower(i.email)=? AND b.workos_membership_id=? AND b.workos_updated_at=?
        AND NOT EXISTS (SELECT 1 FROM boing_identities other WHERE other.user_id<>i.user_id AND lower(other.email)=lower(i.email)))`
    const args = [actorId, organizationId, workosOrganizationId, targetId, role, email, previous.membershipId, previous.updatedAt]
    const results = await db.batch([
      db.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
        VALUES(?,?,?,NULL,CASE WHEN ${guard} THEN 'membership.reauthorized' ELSE NULL END,?)`).bind(eventId, organizationId, actorId, ...args, occurredAt),
      db.prepare(`UPDATE boing_workos_membership_bindings SET workos_membership_id=?,workos_updated_at=?
        WHERE organization_id=? AND user_id=? AND ${guard} AND EXISTS (SELECT 1 FROM boing_audit_events WHERE id=?)`)
        .bind(approved.membershipId, approved.updatedAt, organizationId, targetId, ...args, eventId),
      db.prepare(`UPDATE boing_audit_events SET action=CASE WHEN changes()=1 THEN action ELSE NULL END WHERE id=?`).bind(eventId),
    ])
    return results[0]?.meta?.changes === 1 && results[1]?.meta?.changes === 1 && results[2]?.meta?.changes === 1 ? { status: 'updated' } : { status: 'unavailable' }
  } catch { return { status: 'unavailable' } }
}
