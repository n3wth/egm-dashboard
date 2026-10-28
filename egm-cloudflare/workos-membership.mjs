import { rbacConfigured } from './workos-session.mjs'

const api = 'https://api.workos.com/user_management/organization_memberships'
const day = 86400000
const retry = 30 * 60000

function exactMember(row, userId, orgId) {
  return row?.user_id === userId && row.organization_id === orgId && ['active', 'inactive', 'pending'].includes(row.status)
}

// Existing memberships, including inactive and pending, are never changed or
// reactivated. WorkOS roles are managed separately; this only adds a missing
// approved user with the least-privileged member role in the EGM organization.
export async function syncWorkosMember(env, userId, { request = fetch, now = Date.now } = {}) {
  if (!rbacConfigured(env) || !/^user_[A-Za-z0-9]+$/.test(userId ?? '')) return { status: 'unavailable' }
  const ownerId = /^user_[A-Za-z0-9]+$/.test(env.WORKOS_OWNER_USER_ID ?? '') ? env.WORKOS_OWNER_USER_ID : ''
  const eligible = async () => env.DB.prepare("SELECT id,email FROM users WHERE id=? AND verified=1 AND status='approved' AND id<>? AND (?<>'' OR email<>?)").bind(userId, ownerId, ownerId, env.OWNER_EMAIL).first()
  if (!await eligible()) return { status: 'not_eligible' }
  const orgId = env.WORKOS_RBAC_ORGANIZATION_ID, lease = crypto.randomUUID(), time = now()
  await env.DB.prepare("INSERT OR IGNORE INTO workos_membership_sync(user_id,organization_id,state,next_attempt) VALUES(?,?,'new',0)").bind(userId, orgId).run()
  const claimed = await env.DB.prepare('UPDATE workos_membership_sync SET lease_id=?,lease_until=? WHERE user_id=? AND (organization_id<>? OR next_attempt<=?) AND lease_until<=?').bind(lease, time + 30000, userId, orgId, time, time).run()
  if (claimed.meta?.changes !== 1) return { status: 'deferred' }
  let state = 'retry'
  try {
    const url = new URL(api)
    url.searchParams.set('user_id', userId)
    url.searchParams.set('organization_id', orgId)
    // This comma-delimited form matches the WorkOS Node SDK serializer.
    url.searchParams.set('statuses', 'active,inactive,pending')
    url.searchParams.set('limit', '100')
    const headers = { authorization: `Bearer ${env.WORKOS_API_KEY}` }
    const response = await request(url.toString(), { headers, redirect: 'manual', signal: AbortSignal.timeout(10000) })
    if (!response.ok) return { status: 'retry' }
    const list = await response.json()
    if (!Array.isArray(list.data) || !list.list_metadata || !Object.hasOwn(list.list_metadata, 'before') || !Object.hasOwn(list.list_metadata, 'after') || (!list.data.length && (list.list_metadata.after || list.list_metadata.before)) || list.data.some(row => !exactMember(row, userId, orgId)) || list.data.length > 1) return { status: 'retry' }
    if (list.data.length) {
      state = list.data[0].status === 'active' ? 'active' : 'inactive'
      return { status: state }
    }
    // Re-read the local authorization immediately before creating membership.
    if (!await eligible()) { state = 'not_eligible'; return { status: state } }
    const created = await request(api, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ user_id: userId, organization_id: orgId, role_slug: 'member' }), redirect: 'manual', signal: AbortSignal.timeout(10000) })
    if (!created.ok) return { status: 'retry' }
    const member = await created.json()
    if (!exactMember(member, userId, orgId) || member.status !== 'active' || member.role?.slug !== 'member') return { status: 'retry' }
    state = 'active'
    return { status: state }
  } catch {
    return { status: 'retry' }
  } finally {
    const next = now() + (state === 'retry' ? retry : day)
    await env.DB.prepare('UPDATE workos_membership_sync SET organization_id=?,state=?,next_attempt=?,lease_id=NULL,lease_until=0 WHERE user_id=? AND lease_id=?').bind(orgId, state, next, userId, lease).run()
  }
}

// Every approved non-owner will eventually be considered, with missing and
// overdue records ordered first. One run makes at most 20 provider requests.
export async function syncWorkosMemberships(env, options = {}) {
  if (!rbacConfigured(env)) return { status: 'unavailable', attempted: 0 }
  const time = (options.now ?? Date.now)()
  const ownerId = /^user_[A-Za-z0-9]+$/.test(env.WORKOS_OWNER_USER_ID ?? '') ? env.WORKOS_OWNER_USER_ID : ''
  const rows = await env.DB.prepare("SELECT u.id FROM users u LEFT JOIN workos_membership_sync m ON m.user_id=u.id WHERE u.verified=1 AND u.status='approved' AND u.id<>? AND (?<>'' OR u.email<>?) AND (m.user_id IS NULL OR m.organization_id<>? OR m.next_attempt<=?) AND (m.lease_until IS NULL OR m.lease_until<=?) ORDER BY COALESCE(m.next_attempt,0),u.id LIMIT 10").bind(ownerId, ownerId, env.OWNER_EMAIL, env.WORKOS_RBAC_ORGANIZATION_ID, time, time).all()
  let attempted = 0
  for (const row of rows.results) { await syncWorkosMember(env, row.id, options); attempted++ }
  return { status: 'checked', attempted }
}
