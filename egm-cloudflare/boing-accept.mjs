import { invitationTokenHash, normalizeInvitationEmail, validInvitationToken } from './boing-invites.mjs'
import { verifyWorkosMembership } from './boing-workos.mjs'

// The user is a freshly authenticated, provider-verified server session. This
// accepts only an already-active WorkOS membership: it does not provision one.
// Every subsequent request must independently reverify provider membership.
async function acceptInvitationHash(env, hash, user, { request = fetch, now = () => new Date().toISOString(), workosInvitationId = null, expectedWorkosOrganizationId = null, expectedRole = null } = {}) {
  const email = normalizeInvitationEmail(user?.email)
  if (!env?.DB?.prepare || !env.DB.batch || !/^[a-f0-9]{64}$/.test(hash ?? '') || !email ||
      user?.verified !== 1 || user.status !== 'active' || !/^user_[A-Za-z0-9]+$/.test(user.id ?? '') || typeof now !== 'function') return { status: 'denied' }
  try {
    const at = now()
    // A provider-bound invitation cannot use the preprovisioned-only path.
    // Missing schema fails closed until the additive migration is applied.
    if (workosInvitationId === null) {
      const bound = await env.DB.prepare(`SELECT b.invitation_id FROM boing_workos_invitation_bindings b
        JOIN boing_invitations i ON i.id=b.invitation_id WHERE i.token_hash=?`).bind(hash).first()
      if (bound) return { status: 'denied' }
    }
    const bindingCheck = workosInvitationId === null
      ? ' AND NOT EXISTS (SELECT 1 FROM boing_workos_invitation_bindings b WHERE b.invitation_id=i.id)'
      : ' AND EXISTS (SELECT 1 FROM boing_workos_invitation_bindings b WHERE b.invitation_id=i.id AND b.workos_invitation_id=?)'
    if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at) || Number.isNaN(Date.parse(at))) return { status: 'denied' }
    // A response may be lost after the atomic claim commits. Recover only for
    // the original recipient and an active local membership, after a fresh
    // WorkOS membership check. This never creates or reactivates membership.
    const acceptedLookup = () => env.DB.prepare(`SELECT o.id,o.workos_organization_id FROM boing_invitations i
      JOIN boing_organizations o ON o.id=i.organization_id AND o.status='active'
      JOIN boing_identities u ON u.user_id=i.accepted_by AND u.status='active' AND lower(u.email)=i.email
      JOIN boing_memberships m ON m.organization_id=o.id AND m.user_id=u.user_id AND m.status='active'
      WHERE i.token_hash=? AND i.email=? AND i.accepted_by=? AND i.accepted_at IS NOT NULL AND i.revoked_at IS NULL
        AND (? IS NULL OR i.role=?)${bindingCheck}`)
      .bind(...[hash, email, user.id, expectedRole, expectedRole, ...(workosInvitationId === null ? [] : [workosInvitationId])]).first()
    const lookup = await env.DB.prepare(`SELECT o.id,o.workos_organization_id FROM boing_invitations i
      JOIN boing_organizations o ON o.id=i.organization_id
      JOIN boing_identities u ON u.user_id=? AND u.status='active' AND lower(u.email)=i.email
      WHERE i.token_hash=? AND i.email=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at>? AND o.status='active'
        AND NOT EXISTS (SELECT 1 FROM boing_memberships m WHERE m.organization_id=o.id AND m.user_id=u.user_id)`)
      .bind(user.id, hash, email, at).first()
    if (!lookup) {
      const accepted = await acceptedLookup()
      if (!accepted || !/^org_[A-Za-z0-9]+$/.test(accepted.workos_organization_id ?? '') ||
          (expectedWorkosOrganizationId !== null && accepted.workos_organization_id !== expectedWorkosOrganizationId)) return { status: 'denied' }
      const verified = await verifyWorkosMembership(env, user, accepted.workos_organization_id, request)
      if (verified.status !== 'allowed') return { status: verified.status }
      if (env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true') {
        const binding = await env.DB.prepare('SELECT workos_membership_id,workos_updated_at FROM boing_workos_membership_bindings WHERE organization_id=? AND user_id=?').bind(accepted.id, user.id).first()
        if (!binding || binding.workos_membership_id !== verified.membershipId || binding.workos_updated_at !== verified.updatedAt) return { status: 'denied' }
      }
      const current = await acceptedLookup()
      if (!current || current.id !== accepted.id || current.workos_organization_id !== accepted.workos_organization_id) return { status: 'denied' }
      return { status: 'already_accepted', organizationId: current.id }
    }
    if (!/^org_[A-Za-z0-9]+$/.test(lookup.workos_organization_id ?? '') ||
        (expectedWorkosOrganizationId !== null && lookup.workos_organization_id !== expectedWorkosOrganizationId)) return { status: 'denied' }
    const verified = await verifyWorkosMembership(env, user, lookup.workos_organization_id, request)
    if (verified.status !== 'allowed') return { status: verified.status }
    const claimAt = now()
    if (typeof claimAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(claimAt) || Number.isNaN(Date.parse(claimAt))) return { status: 'denied' }
    const nonce = crypto.randomUUID()
    const statements = [
      env.DB.prepare(`UPDATE boing_invitations SET accepted_at=?,accepted_by=?,acceptance_id=?
        WHERE token_hash=? AND email=? AND organization_id=? AND expires_at>? AND accepted_at IS NULL AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM boing_organizations o WHERE o.id=boing_invitations.organization_id AND o.status='active' AND o.workos_organization_id=?)
          AND EXISTS (SELECT 1 FROM boing_identities u WHERE u.user_id=? AND u.status='active' AND lower(u.email)=boing_invitations.email)
          AND NOT EXISTS (SELECT 1 FROM boing_memberships m WHERE m.organization_id=boing_invitations.organization_id AND m.user_id=?)
          AND (? IS NULL OR role=?)
          ${workosInvitationId === null ? 'AND NOT EXISTS (SELECT 1 FROM boing_workos_invitation_bindings b WHERE b.invitation_id=boing_invitations.id)' : 'AND EXISTS (SELECT 1 FROM boing_workos_invitation_bindings b WHERE b.invitation_id=boing_invitations.id AND b.workos_invitation_id=?)'}`)
        .bind(...[claimAt, user.id, nonce, hash, email, lookup.id, claimAt, lookup.workos_organization_id, user.id, user.id, expectedRole, expectedRole, ...(workosInvitationId === null ? [] : [workosInvitationId])]),
      env.DB.prepare(`INSERT INTO boing_memberships(organization_id,user_id,role,status,created_at)
        SELECT organization_id,?,role,'active',? FROM boing_invitations WHERE token_hash=? AND acceptance_id=? AND accepted_by=?`)
        .bind(user.id, claimAt, hash, nonce, user.id),
      env.DB.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
        SELECT ?,organization_id,?,NULL,'invitation.accepted',? FROM boing_invitations
        WHERE token_hash=? AND acceptance_id=? AND accepted_by=?`)
        .bind(crypto.randomUUID(), user.id, claimAt, hash, nonce, user.id),
    ]
    if (env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true') {
      statements.push(env.DB.prepare(`INSERT INTO boing_workos_membership_bindings(organization_id,user_id,workos_membership_id,workos_updated_at)
        SELECT organization_id,?,?,? FROM boing_invitations WHERE token_hash=? AND acceptance_id=? AND accepted_by=?`)
        .bind(user.id, verified.membershipId, verified.updatedAt, hash, nonce, user.id))
    }
    const results = await env.DB.batch(statements)
    if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1 || results[2]?.meta?.changes !== 1 || (env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true' && results[3]?.meta?.changes !== 1)) return { status: 'denied' }
    return { status: 'accepted', organizationId: lookup.id }
  } catch {
    return { status: 'unavailable' }
  }
}

export async function acceptProvisionedInvitation(env, token, user, options = {}) {
  if (!validInvitationToken(token)) return { status: 'denied' }
  return acceptInvitationHash(env, await invitationTokenHash(token), user, options)
}

// Resolve the provider token only on the server. The WorkOS invitation must
// already have been accepted by this exact verified user and bound by an
// owner to an active local invitation. The plaintext local token is not needed.
export async function acceptWorkosInvitationToken(env, providerToken, user, { request = fetch, now = () => new Date().toISOString() } = {}) {
  const email = normalizeInvitationEmail(user?.email)
  if (!env?.DB?.prepare || !env.DB.batch || !email || user?.verified !== 1 || user.status !== 'active' ||
      !/^user_[A-Za-z0-9]+$/.test(user.id ?? '') || !/^[A-Za-z0-9_-]{10,512}$/.test(providerToken ?? '') ||
      typeof env.WORKOS_API_KEY !== 'string' || !env.WORKOS_API_KEY.trim()) return { status: 'denied' }
  try {
    const response = await request(`https://api.workos.com/user_management/invitations/by_token/${encodeURIComponent(providerToken)}`, {
      headers: { authorization: `Bearer ${env.WORKOS_API_KEY}` }, redirect: 'manual', signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return { status: 'unavailable' }
    const invitation = await response.json()
    if (invitation?.object !== 'invitation' || !/^invitation_[A-Za-z0-9]+$/.test(invitation.id ?? '') ||
        invitation.state !== 'accepted' || invitation.accepted_user_id !== user.id ||
        !/^org_[A-Za-z0-9]+$/.test(invitation.organization_id ?? '') ||
        normalizeInvitationEmail(invitation.email) !== email || invitation.revoked_at !== null ||
        typeof invitation.accepted_at !== 'string' || !['member', 'admin'].includes(invitation.role_slug)) return { status: 'denied' }
    const local = await env.DB.prepare(`SELECT i.token_hash FROM boing_invitations i
      JOIN boing_workos_invitation_bindings b ON b.invitation_id=i.id
      JOIN boing_organizations o ON o.id=i.organization_id
      WHERE b.workos_invitation_id=? AND i.email=? AND i.revoked_at IS NULL
        AND o.status='active' AND o.workos_organization_id=?`)
      .bind(invitation.id, email, invitation.organization_id).first()
    if (!local) return { status: 'denied' }
    return acceptInvitationHash(env, local.token_hash, user, { request, now, workosInvitationId: invitation.id, expectedWorkosOrganizationId: invitation.organization_id, expectedRole: invitation.role_slug })
  } catch { return { status: 'unavailable' } }
}

// This flow never creates or activates a provider membership. The invitee must
// first accept the WorkOS invitation via AuthKit. Provider status, recipient,
// and organization are independently read before the local atomic claim.
export async function acceptBoundWorkosInvitation(env, token, user, { request = fetch, now = () => new Date().toISOString() } = {}) {
  const email = normalizeInvitationEmail(user?.email)
  if (!env?.DB?.prepare || !validInvitationToken(token) || !email || user?.verified !== 1 ||
      user.status !== 'active' || !/^user_[A-Za-z0-9]+$/.test(user.id ?? '') ||
      typeof env.WORKOS_API_KEY !== 'string' || !env.WORKOS_API_KEY.trim()) return { status: 'denied' }
  try {
    const hash = await invitationTokenHash(token)
    const row = await env.DB.prepare(`SELECT b.workos_invitation_id,o.workos_organization_id FROM boing_invitations i
      JOIN boing_workos_invitation_bindings b ON b.invitation_id=i.id
      JOIN boing_organizations o ON o.id=i.organization_id AND o.status='active'
      WHERE i.token_hash=? AND i.email=? AND i.revoked_at IS NULL`).bind(hash, email).first()
    if (!row || !/^invitation_[A-Za-z0-9]+$/.test(row.workos_invitation_id ?? '') ||
        !/^org_[A-Za-z0-9]+$/.test(row.workos_organization_id ?? '')) return { status: 'denied' }
    const response = await request(`https://api.workos.com/user_management/invitations/${row.workos_invitation_id}`, {
      headers: { authorization: `Bearer ${env.WORKOS_API_KEY}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return { status: 'unavailable' }
    const invitation = await response.json()
    if (invitation?.object !== 'invitation' || invitation.id !== row.workos_invitation_id ||
        invitation.state !== 'accepted' || invitation.accepted_user_id !== user.id ||
        invitation.organization_id !== row.workos_organization_id ||
        normalizeInvitationEmail(invitation.email) !== email || invitation.revoked_at !== null ||
        typeof invitation.accepted_at !== 'string' || !['member', 'admin'].includes(invitation.role_slug)) return { status: 'denied' }
    return acceptProvisionedInvitation(env, token, user, { request, now, workosInvitationId: row.workos_invitation_id, expectedWorkosOrganizationId: row.workos_organization_id, expectedRole: invitation.role_slug })
  } catch { return { status: 'unavailable' } }
}

// Select the acceptance path using the server-side binding, never client input.
export async function acceptBoingInvitation(env, token, user, options = {}) {
  if (!env?.DB?.prepare || !validInvitationToken(token)) return { status: 'denied' }
  try {
    const hash = await invitationTokenHash(token)
    const bound = await env.DB.prepare(`SELECT b.workos_invitation_id FROM boing_workos_invitation_bindings b
      JOIN boing_invitations i ON i.id=b.invitation_id WHERE i.token_hash=?`).bind(hash).first()
    return bound
      ? acceptBoundWorkosInvitation(env, token, user, options)
      : acceptProvisionedInvitation(env, token, user, options)
  } catch { return { status: 'unavailable' } }
}
