import { normalizeInvitationEmail } from './boing-invites.mjs'

const enc = new TextEncoder()
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const un64 = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
const validToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{10,512}$/.test(token)
async function key(secret) {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode(`boing-invitation-cookie\0${secret}`)), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// The bearer token is encrypted in a short-lived host-only cookie, not stored
// in the database. Associated data binds the cookie to the signed OAuth state.
export async function sealInviteToken(token, state, secret) {
  if (!validToken(token)) return null
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(state) }, await key(secret), enc.encode(token))
  return `${b64(iv)}.${b64(new Uint8Array(sealed))}`
}

export async function openInviteToken(value, state, secret) {
  if (typeof value !== 'string' || value.length > 1000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const [iv, ciphertext] = value.split('.').map(un64)
    if (iv.length !== 12) return null
    const token = new TextDecoder('utf-8', { fatal: true }).decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(state) }, await key(secret), ciphertext))
    return validToken(token) ? token : null
  } catch { return null }
}

// Only already-bound organization invitations may enter AuthKit signup.
// No provider mutation or outbound email is performed by this lookup.
export async function lookupBoundInvite(env, token, request = fetch, now = Date.now()) {
  if (!validToken(token) || !env?.DB?.prepare || !env.WORKOS_API_KEY || !Number.isSafeInteger(now)) return null
  try {
    const response = await request(`https://api.workos.com/user_management/invitations/by_token/${encodeURIComponent(token)}`, {
      headers: { authorization: `Bearer ${env.WORKOS_API_KEY}` }, redirect: 'manual', signal: AbortSignal.timeout(4000)
    })
    if (!response.ok) return null
    const invite = await response.json()
    const email = normalizeInvitationEmail(invite?.email)
    if (invite?.object !== 'invitation' || !/^invitation_[A-Za-z0-9]+$/.test(invite.id ?? '') || !/^org_[A-Za-z0-9]+$/.test(invite.organization_id ?? '') ||
        !email || !['member', 'admin'].includes(invite.role_slug) || !['pending', 'accepted'].includes(invite.state) || invite.revoked_at !== null ||
        !Number.isFinite(Date.parse(invite.expires_at)) || Date.parse(invite.expires_at) <= now) return null
    const row = await env.DB.prepare(`SELECT i.email FROM boing_invitations i
      JOIN boing_workos_invitation_bindings b ON b.invitation_id=i.id
      JOIN boing_organizations o ON o.id=i.organization_id
      WHERE b.workos_invitation_id=? AND i.email=? AND i.role=? AND i.revoked_at IS NULL
        AND i.expires_at>? AND o.workos_organization_id=? AND o.status='active'`)
      .bind(invite.id, email, invite.role_slug, new Date(now).toISOString(), invite.organization_id).first()
    return row ? { email } : null
  } catch { return null }
}

// Read-only preflight for a future post-sign-in acceptance flow. It deliberately
// performs no WorkOS acceptance or membership mutation: those require a live
// provider test and a strategy for revocation races before they can be enabled.
// The caller supplies only a freshly authenticated, verified WorkOS user.
export async function preflightBoundInviteForUser(env, token, user, { request = fetch, now = Date.now() } = {}) {
  const email = normalizeInvitationEmail(user?.email)
  if (!validToken(token) || !email || user?.verified !== 1 || user.status !== 'active' ||
      !/^user_[A-Za-z0-9]+$/.test(user.id ?? '') || !env?.DB?.prepare ||
      typeof env.WORKOS_API_KEY !== 'string' || !env.WORKOS_API_KEY ||
      !Number.isSafeInteger(now)) return { status: 'denied' }
  try {
    const result = await request(`https://api.workos.com/user_management/invitations/by_token/${encodeURIComponent(token)}`, {
      headers: { authorization: `Bearer ${env.WORKOS_API_KEY}` }, redirect: 'manual', signal: AbortSignal.timeout(4000)
    })
    if (!result.ok) return { status: 'unavailable' }
    const invite = await result.json()
    if (invite?.object !== 'invitation' || !/^invitation_[A-Za-z0-9]+$/.test(invite.id ?? '') ||
        !/^org_[A-Za-z0-9]+$/.test(invite.organization_id ?? '') || normalizeInvitationEmail(invite.email) !== email ||
        invite.state !== 'pending' || invite.revoked_at !== null || invite.accepted_at !== null ||
        !['admin', 'member'].includes(invite.role_slug) || !Number.isFinite(Date.parse(invite.expires_at)) || Date.parse(invite.expires_at) <= now) return { status: 'denied' }
    const lookup = () => env.DB.prepare(`SELECT o.id, i.id AS invitation_id FROM boing_invitations i
      JOIN boing_workos_invitation_bindings b ON b.invitation_id=i.id
      JOIN boing_organizations o ON o.id=i.organization_id
      JOIN boing_identities u ON u.user_id=? AND lower(u.email)=i.email AND u.status='active'
      WHERE b.workos_invitation_id=? AND i.email=? AND i.role=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at>? AND o.status='active' AND o.workos_organization_id=?
        AND NOT EXISTS (SELECT 1 FROM boing_memberships m WHERE m.organization_id=o.id AND m.user_id=u.user_id)`)
      .bind(user.id, invite.id, email, invite.role_slug, new Date(now).toISOString(), invite.organization_id).first()
    const local = await lookup()
    if (!local) return { status: 'denied' }
    const url = new URL('https://api.workos.com/user_management/organization_memberships')
    url.searchParams.set('user_id', user.id)
    url.searchParams.set('organization_id', invite.organization_id)
    url.searchParams.set('limit', '2')
    const memberships = await request(url.href, { headers: { authorization: `Bearer ${env.WORKOS_API_KEY}` }, redirect: 'manual', signal: AbortSignal.timeout(4000) })
    if (!memberships.ok) return { status: 'unavailable' }
    const list = await memberships.json()
    if (list?.object !== 'list' || !Array.isArray(list.data) || list.data.length > 1 || list.list_metadata?.after !== null) return { status: 'denied' }
    const membership = list.data[0]
    if (membership && (membership.user_id !== user.id || membership.organization_id !== invite.organization_id || membership.status !== 'pending')) return { status: 'denied' }
    const current = await lookup()
    return current?.id === local.id && current?.invitation_id === local.invitation_id ? { status: 'ready', organizationId: current.id, invitationId: current.invitation_id, workosInvitationId: invite.id, workosOrganizationId: invite.organization_id } : { status: 'denied' }
  } catch { return { status: 'unavailable' } }
}
