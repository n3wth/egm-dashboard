import { verifyWorkosMembership } from './boing-workos.mjs'

// user must come from a freshly validated server session, not request data.
// organizationSelector is only a lookup key and does not authorize access.
// A caller must create a context on every request and pass its organizationId
// to all downstream queries. This helper does not authenticate a session or
// grant permission to perform a particular operation.
export async function resolveBoingContext(env, user, organizationSelector, request = fetch) {
  if (!user || user.verified !== 1 || user.status !== 'active' ||
      !/^user_[A-Za-z0-9]+$/.test(user.id ?? '') ||
      typeof organizationSelector !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(organizationSelector)) return { status: 'denied' }
  if (!env?.DB?.prepare) return { status: 'unavailable' }

  const bindingRequired = env.BOING_MEMBERSHIP_BINDING_REQUIRED === 'true'
  const lookup = () => env.DB.prepare(`SELECT o.id, o.workos_organization_id, m.role
    ${bindingRequired ? ', b.workos_membership_id, b.workos_updated_at' : ''}
    FROM boing_organizations o
    JOIN boing_memberships m ON m.organization_id = o.id
    JOIN boing_identities u ON u.user_id = m.user_id
    ${bindingRequired ? 'JOIN boing_workos_membership_bindings b ON b.organization_id=m.organization_id AND b.user_id=m.user_id' : ''}
    WHERE o.id = ? AND m.user_id = ? AND o.status = 'active'
      AND m.status = 'active' AND u.status = 'active'`)
    .bind(organizationSelector, user.id).first()

  try {
    const organization = await lookup()
    if (!organization || !/^org_[A-Za-z0-9]+$/.test(organization.workos_organization_id ?? '')) return { status: 'denied' }
    const membership = await verifyWorkosMembership(env, user, organization.workos_organization_id, request)
    if (membership.status !== 'allowed') return membership.status === 'unavailable' ? { status: 'unavailable' } : { status: 'denied' }
    if (bindingRequired && (organization.workos_membership_id !== membership.membershipId || organization.workos_updated_at !== membership.updatedAt)) return { status: 'denied' }
    // WorkOS verification is asynchronous: reject local revocation or remapping
    // during that call. Downstream mutations must still recheck their own access.
    const current = await lookup()
    if (!current || current.workos_organization_id !== organization.workos_organization_id ||
        (bindingRequired && (current.role !== organization.role || current.workos_membership_id !== membership.membershipId || current.workos_updated_at !== membership.updatedAt))) return { status: 'denied' }
    return { status: 'allowed', organizationId: current.id, userId: user.id, role: current.role,
      ...(bindingRequired ? { membershipId: membership.membershipId, membershipUpdatedAt: membership.updatedAt } : {}) }
  } catch {
    return { status: 'unavailable' }
  }
}
