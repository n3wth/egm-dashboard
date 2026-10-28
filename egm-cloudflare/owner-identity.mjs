// Once configured, a stable WorkOS subject is the sole owner identity. A
// changed or reassigned email must never transfer owner privileges.
export function isDashboardOwner(user, env) {
  if (!user || typeof user.id !== 'string') return false
  if (env.WORKOS_OWNER_USER_ID != null && env.WORKOS_OWNER_USER_ID !== '') return /^user_[A-Za-z0-9]+$/.test(env.WORKOS_OWNER_USER_ID) && user.id === env.WORKOS_OWNER_USER_ID
  return user.email === env.OWNER_EMAIL
}
