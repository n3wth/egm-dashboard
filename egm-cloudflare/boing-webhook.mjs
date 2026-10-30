import { setInstallationStatus, verifyGitHubWebhook } from './boing-github-app.mjs'

// Additive schema; never apply automatically. Rows include no webhook payloads.
export const BOING_WEBHOOK_SCHEMA = `CREATE TABLE IF NOT EXISTS boing_github_deliveries (
  delivery_id TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL UNIQUE,
  received_at INTEGER NOT NULL
)`

const MAX_BODY = 1024 * 1024
const json = (body, status) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

async function boundedBody(request) {
  const length = Number(request.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_BODY) throw new Error('too_large')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('invalid_body')
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY) throw new Error('too_large')
      chunks.push(value)
    }
  } finally { try { await reader.cancel() } catch {} }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return body
}

// Only disabling transitions are accepted. GitHub delivery headers are not
// signed, so replay protection is defense in depth, not a freshness proof.
// Reactivation needs an independent fresh GitHub API verification.
export async function handleBoingGithubWebhook(request, env, { now = Date.now() } = {}) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!env?.DB?.prepare || !env?.DB?.batch || !env.GITHUB_WEBHOOK_SECRET ||
      !Number.isSafeInteger(Number(env.GITHUB_APP_ID)) || Number(env.GITHUB_APP_ID) < 1 ||
      !Number.isSafeInteger(now) || now < 0) return json({ error: 'unavailable' }, 503)
  const id = request.headers.get('x-github-delivery')
  const eventType = request.headers.get('x-github-event')
  if (!id || !/^[a-zA-Z0-9-]{1,128}$/.test(id) || !['installation', 'installation_repositories'].includes(eventType)) return json({ error: 'invalid_event' }, 400)
  let raw
  try { raw = await boundedBody(request) } catch (error) { return json({ error: error.message }, error.message === 'too_large' ? 413 : 400) }
  if (!await verifyGitHubWebhook(raw, request.headers.get('x-hub-signature-256'), env.GITHUB_WEBHOOK_SECRET)) return json({ error: 'invalid_signature' }, 401)
  let event
  try { event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) } catch { return json({ error: 'invalid_event' }, 400) }
  if (!event || !Number.isSafeInteger(event.installation?.id) || event.installation.id < 1 ||
      event.installation.app_id !== Number(env.GITHUB_APP_ID)) return json({ error: 'invalid_event' }, 400)
  if (eventType === 'installation' && !['suspend', 'deleted'].includes(event.action)) return json({ error: 'invalid_event' }, 400)
  if (eventType === 'installation_repositories' && !['removed', 'added'].includes(event.action)) return json({ error: 'invalid_event' }, 400)
  // A selection change can race with collection or be replayed after rebinding. Disable
  // the whole installation until fresh provider verification; this also
  // atomically advances every affected project revision and hides old mixed
  // snapshots through setInstallationStatus. No removed private data remains
  // readable while a human reconnects. Headers are unsigned, so only the
  // destructive, fail-closed transition is authorized by this handler.
  const status = eventType === 'installation' && event.action === 'deleted' ? 'deleted' : 'suspended'
  try {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), b => b.toString(16).padStart(2, '0')).join('')
    const claim = await env.DB.prepare('INSERT INTO boing_github_deliveries (delivery_id,body_hash,received_at) VALUES (?,?,?) ON CONFLICT DO NOTHING').bind(id, hash, now).run()
    // Reapply disabling transitions on duplicates. A replay after a fresh
    // reactivation must still disable access, and retry after a processing
    // failure must not leave an installation active. Status changes are
    // idempotent and the body hash keeps replayed payloads from growing storage.
    await setInstallationStatus(env.DB, event.installation.id, status)
    return json({ received: true, duplicate: claim.meta?.changes !== 1 }, 200)
  } catch { return json({ error: 'unavailable' }, 503) }
}
