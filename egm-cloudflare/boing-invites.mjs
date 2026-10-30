import { verifyWorkosMembership } from './boing-workos.mjs'

// Organization invitations. These helpers are not routes and send no email.
// The caller must derive actorId and the accepting user from a verified Boing
// session (authenticateBoingSession) and deliver the returned token itself.
// Management callers must also freshly verify WorkOS membership and pass its
// mapped local organization ID separately from the selected organization.
// Neither is a client assertion. Actors and recipients are boing_identities
// rows; legacy users are never read and grant nothing here.
// Additive schema, applied alongside boing-tenancy-schema.sql.
export const INVITES_SCHEMA = `CREATE TABLE IF NOT EXISTS boing_invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES boing_organizations(id),
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_by TEXT NOT NULL REFERENCES boing_identities(user_id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT REFERENCES boing_identities(user_id),
  acceptance_id TEXT,
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS boing_invitations_active_email ON boing_invitations(organization_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS boing_invitations_organization ON boing_invitations(organization_id, created_at DESC);
CREATE TABLE IF NOT EXISTS boing_workos_invitation_bindings (
  invitation_id TEXT PRIMARY KEY REFERENCES boing_invitations(id),
  workos_invitation_id TEXT NOT NULL UNIQUE
);`

const encoder = new TextEncoder()
const roles = new Set(['admin', 'member'])
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
// Timestamps are ISO strings in this schema; the fixed format keeps SQL
// comparisons on expires_at correct.
const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value))
export const validInvitationToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{32,512}$/.test(token)

export function normalizeInvitationEmail(value) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

export async function invitationTokenHash(token) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function randomToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

// Bind order: organizationId, actorId, verifiedOrganizationId.
const ownerCheck = `EXISTS (
  SELECT 1 FROM boing_organizations o
  JOIN boing_memberships actor ON actor.organization_id=o.id
  JOIN boing_identities actor_user ON actor_user.user_id=actor.user_id
  WHERE o.id=? AND o.status='active' AND actor.user_id=? AND o.id=?
    AND actor.role='owner' AND actor.status='active' AND actor_user.status='active'
)`

// A non-null binding is the exact WorkOS membership version freshly verified
// by the caller. Match it inside each write, not just before the transaction.
const bindingCheck = `EXISTS (SELECT 1 FROM boing_workos_membership_bindings b
  WHERE b.organization_id=? AND b.user_id=? AND b.workos_membership_id=? AND b.workos_updated_at=?)`
const validBinding = binding => binding === null || (typeof binding === 'object' && validId(binding.id) && validTime(binding.updatedAt))
const bindingClause = binding => binding === null ? '' : ` AND ${bindingCheck}`
const bindingArgs = (binding, organizationId, actorId) => binding === null ? [] : [organizationId, actorId, binding.id, binding.updatedAt]

// Bind an already-issued WorkOS invitation without sending or accepting it.
// The provider token is used only for the lookup and is never stored or logged.
// The caller supplies a freshly verified owner session and organization context.
export async function bindWorkosInvitation(env, actor, verifiedOrganizationId, invitationId, providerToken, { request = fetch, now = new Date().toISOString() } = {}) {
  if (!env?.DB?.prepare || !validId(actor?.id) || actor?.verified !== 1 || actor.status !== 'active' ||
      !validId(verifiedOrganizationId) || !validId(invitationId) || !validTime(now) ||
      typeof providerToken !== 'string' || !/^[A-Za-z0-9_-]{10,512}$/.test(providerToken) ||
      typeof env.WORKOS_API_KEY !== 'string' || !env.WORKOS_API_KEY.trim()) return false
  try {
    const local = await env.DB.prepare(`SELECT i.email,i.role,o.workos_organization_id FROM boing_invitations i
      JOIN boing_organizations o ON o.id=i.organization_id
      WHERE i.id=? AND i.organization_id=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?
      AND ${ownerCheck}`).bind(invitationId, verifiedOrganizationId, now, verifiedOrganizationId, actor.id, verifiedOrganizationId).first()
    if (!local || !/^org_[A-Za-z0-9]+$/.test(local.workos_organization_id ?? '')) return false
    if ((await verifyWorkosMembership(env, actor, local.workos_organization_id, request)).status !== 'allowed') return false
    const response = await request(`https://api.workos.com/user_management/invitations/by_token/${encodeURIComponent(providerToken)}`, {
      headers: { authorization: `Bearer ${env.WORKOS_API_KEY}` }, redirect: 'manual', signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return false
    const invite = await response.json()
    if (invite?.object !== 'invitation' || !/^invitation_[A-Za-z0-9]+$/.test(invite.id ?? '') ||
        invite.state !== 'pending' || invite.revoked_at !== null || invite.accepted_at !== null ||
        normalizeInvitationEmail(invite.email) !== local.email || invite.organization_id !== local.workos_organization_id ||
        invite.role_slug !== local.role || !validTime(invite.expires_at) || invite.expires_at <= now) return false
    // The provider invitation lookup can outlast the owner's authorization.
    // Recheck it and bind the observed provider version into the local write.
    const actorVersion = await verifyWorkosMembership(env, actor, local.workos_organization_id, request)
    if (actorVersion.status !== 'allowed') return false
    const versionSql = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true'
      ? ' AND EXISTS (SELECT 1 FROM boing_workos_membership_bindings b WHERE b.organization_id=? AND b.user_id=? AND b.workos_membership_id=? AND b.workos_updated_at=?)' : ''
    const versionArgs = versionSql ? [verifiedOrganizationId, actor.id, actorVersion.membershipId, actorVersion.updatedAt] : []
    const result = await env.DB.prepare(`INSERT INTO boing_workos_invitation_bindings(invitation_id,workos_invitation_id)
      SELECT i.id,? FROM boing_invitations i JOIN boing_organizations o ON o.id=i.organization_id
      WHERE i.id=? AND i.organization_id=? AND i.email=? AND i.role=? AND o.workos_organization_id=?
        AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? AND ${ownerCheck}${versionSql}
      ON CONFLICT DO NOTHING`).bind(invite.id, invitationId, verifiedOrganizationId, local.email, local.role,
        local.workos_organization_id, now, verifiedOrganizationId, actor.id, verifiedOrganizationId, ...versionArgs).run()
    return result.meta?.changes === 1
  } catch { return false }
}

// Creates one pending invitation per (organization, email). The plaintext
// token is returned once for delivery and only its hash is stored. Returns
// null for unauthorized actors, invalid input, an existing member, or an
// active invitation for the same address. An expired invitation for the
// address is revoked in the same transaction so a fresh one can replace it.
export const MAX_PENDING_INVITATIONS = 100
export async function createInvitation(db, actorId, verifiedOrganizationId, { organizationId, email, role = 'member', expiresInDays = 7, now = new Date().toISOString(), membershipBinding = null } = {}) {
  const address = normalizeInvitationEmail(email)
  if (!db?.batch || !validId(actorId) || !validId(organizationId) || !validId(verifiedOrganizationId) || !address || !roles.has(role) ||
      !Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30 || !validTime(now) || !validBinding(membershipBinding)) return null
  const id = crypto.randomUUID()
  const token = randomToken()
  const hash = await invitationTokenHash(token)
  const expiresAt = new Date(Date.parse(now) + expiresInDays * 86400000).toISOString()
  const results = await db.batch([
    db.prepare(`UPDATE boing_invitations SET revoked_at=?
      WHERE organization_id=? AND email=? AND expires_at<=? AND accepted_at IS NULL AND revoked_at IS NULL
        AND ${ownerCheck}${bindingClause(membershipBinding)}`).bind(now, organizationId, address, now, organizationId, actorId, verifiedOrganizationId, ...bindingArgs(membershipBinding, organizationId, actorId)),
    db.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
      SELECT ?,?,?,NULL,'invitation.expired_revoked',? WHERE changes()>0`).bind(crypto.randomUUID(), organizationId, actorId, now),
    db.prepare(`INSERT INTO boing_invitations(id,organization_id,token_hash,email,role,created_by,created_at,expires_at)
      SELECT ?,o.id,?,?,?,?,?,? FROM boing_organizations o
      WHERE o.id=? AND ${ownerCheck}${bindingClause(membershipBinding)}
        AND (SELECT COUNT(*) FROM boing_invitations pending WHERE pending.organization_id=o.id
          AND pending.accepted_at IS NULL AND pending.revoked_at IS NULL AND pending.expires_at>?) < ${MAX_PENDING_INVITATIONS}
        AND NOT EXISTS (
          SELECT 1 FROM boing_memberships m JOIN boing_identities u ON u.user_id=m.user_id
          WHERE m.organization_id=o.id AND lower(u.email)=?
        )
      ON CONFLICT DO NOTHING`).bind(id, hash, address, role, actorId, now, expiresAt, organizationId, organizationId, actorId, verifiedOrganizationId, ...bindingArgs(membershipBinding, organizationId, actorId), now, address),
    db.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
      SELECT ?,?,?,NULL,'invitation.created',? WHERE changes()=1`).bind(crypto.randomUUID(), organizationId, actorId, now),
  ])
  if (results[2]?.meta?.changes !== 1 || results[3]?.meta?.changes !== 1) return null
  return { id, token, email: address, role, expiresAt }
}

// Returns null when the actor is not an active owner of the organization.
// The token hash is never returned.
export async function listInvitations(db, actorId, verifiedOrganizationId, organizationId, now = new Date().toISOString()) {
  if (!db?.prepare || !validId(actorId) || !validId(organizationId) || !validId(verifiedOrganizationId) || !validTime(now)) return null
  const allowed = await db.prepare(`SELECT o.id FROM boing_organizations o WHERE o.id=? AND ${ownerCheck}`).bind(organizationId, organizationId, actorId, verifiedOrganizationId).first()
  if (!allowed) return null
  // Recheck authorization in the read itself.
  const result = await db.prepare(`SELECT i.id,i.email,i.role,i.created_by,i.created_at,i.expires_at,i.accepted_at,i.accepted_by,i.revoked_at,
      CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted' WHEN i.revoked_at IS NOT NULL THEN 'revoked'
        WHEN i.expires_at<=? THEN 'expired' ELSE 'pending' END AS status
    FROM boing_invitations i WHERE i.organization_id=? AND ${ownerCheck}
    ORDER BY i.created_at DESC,i.id DESC LIMIT 200`).bind(now, organizationId, organizationId, actorId, verifiedOrganizationId).all()
  return result.results
}

// Only pending invitations can be revoked. Authorization is part of the
// UPDATE so a removed owner cannot revoke after an earlier check.
export async function revokeInvitation(db, actorId, verifiedOrganizationId, organizationId, invitationId, membershipBinding = null, now = new Date().toISOString()) {
  if (!db?.batch || !validId(actorId) || !validId(organizationId) || !validId(verifiedOrganizationId) || !validId(invitationId) || !validTime(now) || !validBinding(membershipBinding)) return false
  const result = await db.batch([
    db.prepare(`UPDATE boing_invitations SET revoked_at=?
      WHERE id=? AND organization_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND ${ownerCheck}${bindingClause(membershipBinding)}`).bind(now, invitationId, organizationId, organizationId, actorId, verifiedOrganizationId, ...bindingArgs(membershipBinding, organizationId, actorId)),
    db.prepare(`INSERT INTO boing_audit_events(id,organization_id,actor_id,project_id,action,occurred_at)
      SELECT ?,?,?,NULL,'invitation.revoked',? WHERE changes()=1`).bind(crypto.randomUUID(), organizationId, actorId, now),
  ])
  return result[0]?.meta?.changes === 1 && result[1]?.meta?.changes === 1
}

// Single-use claim. user is the { id, email, verified } object returned by
// authenticateBoingSession, so email is the provider-verified address. The
// accepting user must already exist as an active identity whose stored email
// matches the invited address; the session email must agree as well. The
// identity status is read from the database, never from the caller, so a
// suspended identity cannot accept. The batch is transactional and the acceptance
// nonce ties the membership insert to this exact successful claim, so
// concurrent attempts produce at most one membership. Any existing
// membership in the organization, including a suspended one, blocks
// acceptance; reinstatement is a separate owner action.
// Returns { organizationId, role } or null.
export async function acceptInvitation(db, token, user, now = new Date().toISOString()) {
  const address = normalizeInvitationEmail(user?.email)
  if (!db?.batch || !validInvitationToken(token) || !validId(user?.id) || !address ||
      user.verified !== 1 || !validTime(now)) return null
  const hash = await invitationTokenHash(token)
  const nonce = crypto.randomUUID()
  const results = await db.batch([
    db.prepare(`UPDATE boing_invitations SET accepted_at=?,accepted_by=?,acceptance_id=?
      WHERE token_hash=? AND expires_at>? AND accepted_at IS NULL AND revoked_at IS NULL AND email=?
        AND EXISTS (SELECT 1 FROM boing_organizations o WHERE o.id=boing_invitations.organization_id AND o.status='active')
        AND EXISTS (SELECT 1 FROM boing_identities u WHERE u.user_id=? AND lower(u.email)=boing_invitations.email AND u.status='active')
        AND NOT EXISTS (SELECT 1 FROM boing_workos_invitation_bindings b WHERE b.invitation_id=boing_invitations.id)
        AND NOT EXISTS (SELECT 1 FROM boing_memberships m WHERE m.organization_id=boing_invitations.organization_id AND m.user_id=?)`)
      .bind(now, user.id, nonce, hash, now, address, user.id, user.id),
    db.prepare(`INSERT INTO boing_memberships(organization_id,user_id,role,status,created_at)
      SELECT organization_id,?,role,'active',? FROM boing_invitations WHERE token_hash=? AND acceptance_id=?`)
      .bind(user.id, now, hash, nonce),
  ])
  if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1) return null
  const accepted = await db.prepare('SELECT organization_id,role FROM boing_invitations WHERE token_hash=? AND acceptance_id=?').bind(hash, nonce).first()
  return accepted ? { organizationId: accepted.organization_id, role: accepted.role } : null
}
