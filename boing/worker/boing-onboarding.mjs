import { invitationTokenHash, normalizeInvitationEmail, validInvitationToken } from './boing-invites.mjs'
import { verifyWorkosMembership } from './boing-workos.mjs'
import { acceptBoingInvitation, acceptWorkosInvitationToken } from './boing-accept.mjs'

const response = (body, status) => Response.json(body, { status, headers: {
  'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff'
} })

// Invitation acceptance is independent of an already-selected workspace.
// Only the main app origin can mutate membership; tenant hosts remain read-only.
// A token is accepted in a bounded POST body, never in a URL or response.
export async function handleInvitationAcceptance(request, env, user, { accept = acceptBoingInvitation, acceptWorkos = acceptWorkosInvitationToken } = {}) {
  if (new URL(request.url).pathname !== '/api/boing/invitations/accept') return null
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405)
  if (!env?.APP_URL || new URL(request.url).origin !== env.APP_URL || request.headers.get('origin') !== env.APP_URL) return response({ error: 'invalid_origin' }, 403)
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return response({ error: 'json_required' }, 415)
  if (Number(request.headers.get('content-length')) > 2048 || !request.body) return response({ error: 'invalid_request' }, 400)
  let data
  const reader = request.body.getReader()
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let raw = '', size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2048) { await reader.cancel(); return response({ error: 'invalid_request' }, 400) }
      raw += decoder.decode(value, { stream: true })
    }
    data = JSON.parse(raw + decoder.decode())
  } catch { return response({ error: 'invalid_request' }, 400) }
  finally { reader.releaseLock() }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 1 ||
      !(validInvitationToken(data.token) || typeof data.workosToken === 'string' && /^[A-Za-z0-9_-]{10,512}$/.test(data.workosToken))) return response({ error: 'invalid_request' }, 400)
  try {
    const result = data.workosToken ? await acceptWorkos(env, data.workosToken, user) : await accept(env, data.token, user)
    if (result?.status === 'unavailable') return response({ error: 'service_unavailable' }, 503)
    if (!['accepted', 'already_accepted'].includes(result?.status) || !/^[A-Za-z0-9_-]{1,128}$/.test(result.organizationId ?? '')) return response({ error: 'invitation_unavailable' }, 403)
    return response({ organizationId: result.organizationId }, 200)
  } catch { return response({ error: 'service_unavailable' }, 503) }
}

// Read-only preflight for the existing invitation flow. The user and clock must
// come from a freshly validated server session and server clock. This does not
// approve a user, create a WorkOS membership, consume a token, or send email.
// An active Boing identity is required independently of legacy EGM approval.
export async function checkInvitationReadiness(env, token, user, { now = new Date().toISOString(), request = fetch } = {}) {
  const email = normalizeInvitationEmail(user?.email)
  if (!env?.DB?.prepare || !validInvitationToken(token) || !email ||
      !/^user_[A-Za-z0-9]+$/.test(user?.id ?? '') || user.verified !== 1 || user.status !== 'active' ||
      typeof now !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(now) ||
      Number.isNaN(Date.parse(now))) return { status: 'denied' }

  try {
    const hash = await invitationTokenHash(token)
    const lookup = () => env.DB.prepare(`SELECT o.id, o.workos_organization_id
      FROM boing_invitations i JOIN boing_organizations o ON o.id=i.organization_id
      JOIN boing_identities u ON u.user_id=? AND lower(u.email)=i.email AND u.status='active'
      WHERE i.token_hash=? AND i.email=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at>? AND o.status='active'
        AND NOT EXISTS (SELECT 1 FROM boing_memberships m WHERE m.organization_id=o.id AND m.user_id=u.user_id)`)
      .bind(user.id, hash, email, now).first()
    const invitation = await lookup()
    if (!invitation || !/^org_[A-Za-z0-9]+$/.test(invitation.workos_organization_id ?? '')) return { status: 'denied' }
    const membership = await verifyWorkosMembership(env, user, invitation.workos_organization_id, request)
    if (membership.status !== 'allowed') return { status: membership.status }
    const current = await lookup()
    if (!current || current.id !== invitation.id || current.workos_organization_id !== invitation.workos_organization_id) return { status: 'denied' }
    // Readiness is not authorization to consume later: all checks can become
    // stale, and acceptance must be atomic with its own authorization checks.
    return { status: 'ready' }
  } catch {
    return { status: 'unavailable' }
  }
}
