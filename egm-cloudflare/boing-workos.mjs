// The caller must obtain expectedOrganizationId from the server's tenant record,
// and user from a verified session. Neither can be trusted from a request body.
export async function verifyWorkosMembership(env, user, expectedOrganizationId, request = fetch) {
  if (!user || user.verified !== 1 || user.status !== 'active' ||
      !/^user_[A-Za-z0-9]+$/.test(user.id ?? '') ||
      !/^org_[A-Za-z0-9]+$/.test(expectedOrganizationId ?? '') ||
      typeof env?.WORKOS_API_KEY !== 'string' || !env.WORKOS_API_KEY.trim()) {
    return { status: 'denied' }
  }

  const url = new URL('https://api.workos.com/user_management/organization_memberships')
  url.searchParams.set('user_id', user.id)
  url.searchParams.set('organization_id', expectedOrganizationId)
  url.searchParams.set('limit', '2')
  try {
    const response = await request(url.href, {
      headers: { authorization: `Bearer ${env.WORKOS_API_KEY}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(4000)
    })
    if (!response.ok) return { status: 'unavailable' }
    const result = await response.json()
    if (result?.object !== 'list' || !Array.isArray(result.data) ||
        !result.list_metadata || typeof result.list_metadata !== 'object' ||
        !Object.hasOwn(result.list_metadata, 'after') || result.list_metadata.after !== null ||
        result.data.length > 1) return { status: 'denied' }
    const membership = result.data[0]
    if (!membership || membership.user_id !== user.id ||
        membership.organization_id !== expectedOrganizationId || membership.status !== 'active') {
      return { status: 'denied' }
    }
    if (env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true') {
      // A membership identifier alone cannot detect deactivation/reactivation.
      // A provider version change requires an explicit new local approval.
      if (!/^om_[A-Za-z0-9]{1,120}$/.test(membership.id ?? '') ||
          typeof membership.updated_at !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(membership.updated_at) ||
          !Number.isFinite(Date.parse(membership.updated_at))) return { status: 'denied' }
      return { status: 'allowed', membershipId: membership.id, updatedAt: membership.updated_at }
    }
    return { status: 'allowed' }
  } catch {
    return { status: 'unavailable' }
  }
}
