const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

// Fetch from WorkOS by the already-verified JWT subject, never by email.
export async function readVerifiedWorkosEmail(env, userId, request = fetch) {
  if (!/^user_[A-Za-z0-9]+$/.test(userId ?? '') || !env.WORKOS_API_KEY) return null
  try {
    const response = await request(`https://api.workos.com/user_management/users/${userId}`, { headers: { authorization: `Bearer ${env.WORKOS_API_KEY}` }, redirect: 'manual', signal: AbortSignal.timeout(5000) })
    if (!response.ok) return null
    const user = await response.json(), email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : ''
    return user.id === userId && user.email_verified === true && validEmail(email) ? email : null
  } catch { return null }
}

// An authenticated, verified WorkOS user can change their own email. The
// stable subject stays fixed; local approval/denial and owner status do not.
export async function reconcileVerifiedEmail(env, existing, email) {
  if (!existing?.id || !validEmail(email)) return 'conflict'
  if (existing.email === email) return 'unchanged'
  // Before owner identity is pinned, an email change cannot transfer or lose
  // owner authority. Reauthentication with a configured pin is required.
  if (!env.WORKOS_OWNER_USER_ID && (existing.email === env.OWNER_EMAIL || email === env.OWNER_EMAIL)) return 'conflict'
  const at = new Date().toISOString()
  const result = await env.DB.batch([
    env.DB.prepare('UPDATE users SET email=? WHERE id=? AND email=? AND NOT EXISTS (SELECT 1 FROM users WHERE email=? AND id<>?)').bind(email, existing.id, existing.email, email, existing.id),
    env.DB.prepare("INSERT INTO audit(id,user_id,action,actor,created_at) SELECT ?,id,'email_updated',id,? FROM users WHERE changes()=1 AND id=? AND email=?").bind(crypto.randomUUID(), at, existing.id, email)
  ])
  if (result[0].meta?.changes === 1) return 'updated'
  // Concurrent requests for the same change are idempotent.
  const current = await env.DB.prepare('SELECT email FROM users WHERE id=?').bind(existing.id).first()
  return current?.email === email ? 'unchanged' : 'conflict'
}
