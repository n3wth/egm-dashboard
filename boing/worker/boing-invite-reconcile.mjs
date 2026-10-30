import { normalizeInvitationEmail } from './boing-invites.mjs'

// Observations are evidence for an operator, never authorization to retry or
// grant membership. The reservation remains remote_attempted indefinitely.
export const INVITATION_RECONCILIATION_SCHEMA = `CREATE TABLE IF NOT EXISTS boing_invitation_reconciliation_events (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES boing_invitation_reservations(reservation_id),
  outcome TEXT NOT NULL CHECK(outcome IN ('pending','accepted','review','unavailable')),
  observed_at INTEGER NOT NULL
);`

// The user must come from a freshly verified server session. This is not wired
// to an HTTP route and performs only WorkOS GETs. A provider outcome can change
// immediately after observation; none of these outcomes permits a retry.
export async function reconcileInvitationAttempt(env, token, user, reservationId, { request = fetch, now = Date.now() } = {}) {
  const email = normalizeInvitationEmail(user?.email)
  if (!env?.DB?.prepare || typeof env.WORKOS_API_KEY !== 'string' || !env.WORKOS_API_KEY.trim() ||
      !/^[A-Za-z0-9_-]{10,512}$/.test(token ?? '') || !/^[0-9a-f-]{36}$/.test(reservationId ?? '') ||
      !/^user_[A-Za-z0-9]+$/.test(user?.id ?? '') || user.verified !== 1 || user.status !== 'active' ||
      !email || !Number.isSafeInteger(now) || now < 0) return { status: 'denied' }
  try {
    const lookup = () => env.DB.prepare(`SELECT r.invitation_id,r.workos_invitation_id,r.workos_organization_id,
        i.email,i.role,i.revoked_at,i.accepted_at,i.expires_at,o.status AS organization_status,
        o.workos_organization_id AS current_workos_organization_id,u.email AS user_email,u.status AS user_status,
        b.workos_invitation_id AS current_workos_invitation_id,
        (SELECT m.status FROM boing_memberships m WHERE m.organization_id=i.organization_id AND m.user_id=r.user_id) AS membership_status
      FROM boing_invitation_reservations r JOIN boing_invitations i ON i.id=r.invitation_id
      JOIN boing_organizations o ON o.id=i.organization_id JOIN boing_identities u ON u.user_id=r.user_id
      LEFT JOIN boing_workos_invitation_bindings b ON b.invitation_id=i.id
      WHERE r.reservation_id=? AND r.user_id=? AND r.status='remote_attempted'`).bind(reservationId, user.id).first()
    const local = await lookup()
    if (!local || normalizeInvitationEmail(local.user_email) !== email || local.user_status !== 'active' || local.email !== email) return { status: 'denied' }
    let outcome = 'review'
    if (local.organization_status === 'active' && local.revoked_at === null && local.accepted_at === null &&
        Date.parse(local.expires_at) > now && local.membership_status === null &&
        local.workos_organization_id === local.current_workos_organization_id && local.workos_invitation_id === local.current_workos_invitation_id) {
      try {
        const options = { headers: { authorization: `Bearer ${env.WORKOS_API_KEY}` }, redirect: 'manual', signal: AbortSignal.timeout(4000) }
        const response = await request(`https://api.workos.com/user_management/invitations/by_token/${encodeURIComponent(token)}`, options)
        if (!response.ok) outcome = 'unavailable'
        else {
          const invite = await response.json()
          const matches = invite?.object === 'invitation' && invite.id === local.workos_invitation_id &&
            invite.organization_id === local.workos_organization_id && normalizeInvitationEmail(invite.email) === email &&
            invite.role_slug === local.role && invite.revoked_at === null && Date.parse(invite.expires_at) > now
          if (matches && ((invite.state === 'pending' && invite.accepted_at === null) ||
              (invite.state === 'accepted' && invite.accepted_user_id === user.id && typeof invite.accepted_at === 'string'))) {
            const url = new URL('https://api.workos.com/user_management/organization_memberships')
            url.searchParams.set('user_id', user.id)
            url.searchParams.set('organization_id', local.workos_organization_id)
            url.searchParams.set('limit', '2')
            const response = await request(url.href, options)
            if (!response.ok) outcome = 'unavailable'
            else {
              const list = await response.json()
              if (list?.object === 'list' && Array.isArray(list.data) && list.data.length <= 1 && list.list_metadata?.after === null) {
                const member = list.data[0]
                if (invite.state === 'pending' && (!member || (member.user_id === user.id && member.organization_id === local.workos_organization_id && member.status === 'pending'))) outcome = 'pending'
                if (invite.state === 'accepted' && member?.user_id === user.id && member.organization_id === local.workos_organization_id && member.status === 'active') outcome = 'accepted'
              }
            }
          }
        }
      } catch { outcome = 'unavailable' }
    }
    // Record only if the local state observed before provider reads is still
    // identical. Otherwise a subsequent operator review must start over.
    const current = await lookup()
    if (!current || JSON.stringify(current) !== JSON.stringify(local)) return { status: 'denied' }
    const written = await env.DB.prepare(`INSERT INTO boing_invitation_reconciliation_events(id,reservation_id,outcome,observed_at)
      SELECT ?,r.reservation_id,?,? FROM boing_invitation_reservations r
      JOIN boing_invitations i ON i.id=r.invitation_id JOIN boing_identities u ON u.user_id=r.user_id
      JOIN boing_organizations o ON o.id=i.organization_id
      LEFT JOIN boing_workos_invitation_bindings b ON b.invitation_id=i.id
      WHERE r.reservation_id=? AND r.user_id=? AND r.status='remote_attempted' AND u.status='active' AND lower(u.email)=? AND i.email=?
        AND r.workos_invitation_id=? AND r.workos_organization_id=? AND i.role=? AND i.revoked_at IS ? AND i.accepted_at IS ? AND i.expires_at=?
        AND o.status=? AND o.workos_organization_id IS ? AND b.workos_invitation_id IS ?
        AND (SELECT m.status FROM boing_memberships m WHERE m.organization_id=i.organization_id AND m.user_id=r.user_id) IS ?`)
      .bind(crypto.randomUUID(), outcome, now, reservationId, user.id, email, email, local.workos_invitation_id, local.workos_organization_id,
        local.role, local.revoked_at, local.accepted_at, local.expires_at, local.organization_status, local.current_workos_organization_id,
        local.current_workos_invitation_id, local.membership_status).run()
    return written.meta?.changes === 1 ? { status: outcome } : { status: 'denied' }
  } catch { return { status: 'unavailable' } }
}
