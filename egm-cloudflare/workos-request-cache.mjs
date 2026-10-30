// Isolate memory only. A successful WorkOS read is reused for a short TTL so
// dashboard polls do not call WorkOS on every request. Revocation, email
// changes, and permission changes apply on the next miss. Failures are not
// cached, and concurrent callers share one in-flight read.
const stores = new WeakMap()

export async function cachedWorkosRead(env, key, ttlMs, load, now = Date.now) {
  const ttl = Number(ttlMs)
  if (!Number.isFinite(ttl) || ttl <= 0) return load()
  let bucket = stores.get(env)
  if (!bucket) stores.set(env, bucket = new Map())
  const hit = bucket.get(key)
  if (hit && hit.expires > now()) return hit.value
  const pending = Promise.resolve().then(load).then(value => {
    const cacheable = value != null && value.cacheable !== false
    if (!cacheable) {
      if (bucket.get(key)?.value === pending) bucket.delete(key)
      return value
    }
    const stored = Promise.resolve(value)
    bucket.set(key, { expires: now() + ttl, value: stored })
    while (bucket.size > 500) bucket.delete(bucket.keys().next().value)
    return value
  }, error => {
    if (bucket.get(key)?.value === pending) bucket.delete(key)
    throw error
  })
  bucket.set(key, { expires: now() + ttl, value: pending })
  return pending
}
