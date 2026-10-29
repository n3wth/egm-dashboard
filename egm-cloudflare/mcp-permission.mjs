// WorkOS Connect (MCP) tokens carry org_id but no role or permissions claim.
// Resolve the user's effective permissions from their active membership in the
// EGM organization, as WorkOS documents for Connect tokens. Grants nothing new:
// the result must still include the configured admin permission.
const memberships = 'https://api.workos.com/user_management/organization_memberships'
const cache = new Map()
const ttl = 60000

export async function connectTokenIsAdmin(env, userId, orgId, { request = fetch, now = Date.now } = {}) {
  if (!/^user_[A-Za-z0-9]+$/.test(userId ?? '') || orgId !== env.WORKOS_RBAC_ORGANIZATION_ID) return false
  const permission = env.WORKOS_RBAC_PERMISSION || 'egm:dashboard:admin'
  const key = `${userId}:${orgId}`
  const hit = cache.get(key)
  if (hit && hit.expires > now()) return hit.admin
  const headers = { authorization: `Bearer ${env.WORKOS_API_KEY}` }
  const get = async url => {
    const response = await request(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw Error('WorkOS lookup failed')
    return response.json()
  }
  const url = new URL(memberships)
  url.searchParams.set('user_id', userId)
  url.searchParams.set('organization_id', orgId)
  url.searchParams.set('statuses', 'active')
  const list = await get(url.toString())
  const member = Array.isArray(list.data) && list.data.length === 1 ? list.data[0] : null
  let admin = false
  if (member && member.user_id === userId && member.organization_id === orgId && member.status === 'active') {
    const slugs = Array.isArray(member.roles) && member.roles.length ? member.roles.map(role => role.slug) : [member.role?.slug]
    if (slugs.includes('admin')) admin = true
    for (const slug of slugs) {
      if (admin || !/^[a-z0-9_:-]+$/i.test(slug ?? '')) continue
      const role = await get(`https://api.workos.com/authorization/organizations/${orgId}/roles/${encodeURIComponent(slug)}`)
      if (Array.isArray(role.permissions) && role.permissions.includes(permission)) admin = true
    }
  }
  cache.set(key, { admin, expires: now() + ttl })
  return admin
}

export function clearConnectPermissionCache() { cache.clear() }
