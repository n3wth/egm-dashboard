import { preflightBoundInviteForUser } from './boing-invite-auth.mjs'
import { normalizeInvitationEmail } from './boing-invites.mjs'

// Operator-only preparation for a future acceptance saga. A remotely attempted
// operation is deliberately never automatically retried or released: an
// ambiguous WorkOS outcome needs reconciliation before any provider mutation.
export const INVITATION_RESERVATION_SCHEMA = `CREATE TABLE IF NOT EXISTS boing_invitation_reservations (
  invitation_id TEXT PRIMARY KEY REFERENCES boing_invitations(id),
  user_id TEXT NOT NULL REFERENCES boing_identities(user_id),
  reservation_id TEXT NOT NULL UNIQUE,
  workos_invitation_id TEXT NOT NULL,
  workos_organization_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('held','remote_attempted')),
  expires_at INTEGER NOT NULL
);`

export async function reserveBoundInvitation(env, token, user, { request = fetch, now = Date.now() } = {}) {
  const email = normalizeInvitationEmail(user?.email)
  if (!env?.DB?.prepare || !email || user?.verified !== 1 || user.status !== 'active' || !Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000 - 300000) return { status: 'denied' }
  const check = await preflightBoundInviteForUser(env, token, user, { request, now })
  if (check.status !== 'ready') return { status: check.status }
  try {
    const reservationId = crypto.randomUUID()
    // Every condition is rechecked in the write; an expired held lease may be
    // replaced, but an ambiguous provider attempt never is.
    const result = await env.DB.prepare(`INSERT INTO boing_invitation_reservations(invitation_id,user_id,reservation_id,workos_invitation_id,workos_organization_id,status,expires_at)
      SELECT i.id,u.user_id,?,b.workos_invitation_id,o.workos_organization_id,'held',? FROM boing_invitations i
      JOIN boing_workos_invitation_bindings b ON b.invitation_id=i.id
      JOIN boing_organizations o ON o.id=i.organization_id
      JOIN boing_identities u ON u.user_id=? AND u.status='active' AND lower(u.email)=i.email
      WHERE i.id=? AND o.id=? AND o.workos_organization_id=? AND b.workos_invitation_id=?
        AND o.status='active' AND i.email=? AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at>?
        AND NOT EXISTS (SELECT 1 FROM boing_memberships m WHERE m.organization_id=o.id AND m.user_id=u.user_id)
      ON CONFLICT(invitation_id) DO UPDATE SET user_id=excluded.user_id,reservation_id=excluded.reservation_id,workos_invitation_id=excluded.workos_invitation_id,workos_organization_id=excluded.workos_organization_id,status='held',expires_at=excluded.expires_at
        WHERE boing_invitation_reservations.status='held' AND boing_invitation_reservations.expires_at<=?`)
      .bind(reservationId, now + 300000, user.id, check.invitationId, check.organizationId, check.workosOrganizationId, check.workosInvitationId, email, new Date(now).toISOString(), now).run()
    return result.meta?.changes === 1 ? { status: 'held', reservationId } : { status: 'denied' }
  } catch { return { status: 'unavailable' } }
}

// Persist intent immediately before a future provider request. This module
// does not perform that request or offer any automatic compensation.
export async function markInvitationRemoteAttempt(env, token, user, reservationId, { request = fetch, now = Date.now() } = {}) {
  if (!env?.DB?.prepare || !user || user.verified !== 1 || user.status !== 'active' || typeof reservationId !== 'string' || !/^[0-9a-f-]{36}$/.test(reservationId) || !Number.isSafeInteger(now) || now < 0) return false
  const email = normalizeInvitationEmail(user.email)
  if (!email) return false
  const preflight = await preflightBoundInviteForUser(env, token, user, { request, now })
  if (preflight.status !== 'ready') return false
  try {
    const result = await env.DB.prepare(`UPDATE boing_invitation_reservations SET status='remote_attempted'
      WHERE reservation_id=? AND user_id=? AND status='held' AND expires_at>? AND invitation_id=? AND workos_invitation_id=? AND workos_organization_id=?
        AND EXISTS (SELECT 1 FROM boing_invitations i JOIN boing_organizations o ON o.id=i.organization_id
          JOIN boing_identities u ON u.user_id=boing_invitation_reservations.user_id
          JOIN boing_workos_invitation_bindings b ON b.invitation_id=i.id
          WHERE i.id=boing_invitation_reservations.invitation_id AND i.email=? AND i.revoked_at IS NULL
          AND i.accepted_at IS NULL AND i.expires_at>? AND o.status='active' AND u.status='active' AND lower(u.email)=i.email
          AND o.workos_organization_id=boing_invitation_reservations.workos_organization_id AND b.workos_invitation_id=boing_invitation_reservations.workos_invitation_id
          AND NOT EXISTS (SELECT 1 FROM boing_memberships m WHERE m.organization_id=o.id AND m.user_id=u.user_id))`)
      .bind(reservationId, user.id, now, preflight.invitationId, preflight.workosInvitationId, preflight.workosOrganizationId, email, new Date(now).toISOString()).run()
    return result.meta?.changes === 1
  } catch { return false }
}
