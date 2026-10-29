// Caches the AuthKit signing keys per fetcher and client. An unknown kid
// triggers at most one refetch per 30 seconds, so key rotation heals quickly
// without letting forged tokens drive requests to WorkOS. If WorkOS is down, a
// key fetched within the last hour still verifies signatures.
// https://workos.com/docs/reference/authkit/session-tokens/jwks
const caches = new WeakMap()
const freshMs = 10 * 60000, retryMs = 30000, staleMs = 60 * 60000

const match = (keys, kid) => {
  const found = keys.filter(k => k.kid === kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'))
  return found.length === 1 ? found[0] : null
}

export async function workosSigningKey(clientId, kid, request = fetch, now = Date.now()) {
  let byClient = caches.get(request)
  if (!byClient) caches.set(request, byClient = new Map())
  const entry = byClient.get(clientId)
  if (entry && now - entry.fetchedAt < freshMs) {
    const hit = match(entry.keys, kid)
    if (hit) return hit
  }
  const usable = () => entry && now - entry.fetchedAt < staleMs ? match(entry.keys, kid) : null
  if (entry && now >= entry.attemptedAt && now - entry.attemptedAt < retryMs) return usable()
  try {
    const response = await request(`https://api.workos.com/sso/jwks/${clientId}`, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw Error('jwks_unavailable')
    const body = await response.json()
    if (!Array.isArray(body.keys)) throw Error('jwks_invalid')
    byClient.set(clientId, { keys: body.keys, fetchedAt: now, attemptedAt: now })
    return match(body.keys, kid)
  } catch {
    byClient.set(clientId, { keys: entry?.keys ?? [], fetchedAt: entry?.fetchedAt ?? -Infinity, attemptedAt: now })
    return usable()
  }
}
