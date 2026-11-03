import { emitWorkosAudit } from './workos-audit-log.mjs'

const encoder = new TextEncoder()
const userId = value => /^user_[A-Za-z0-9]+$/.test(value ?? '')
const orgId = value => /^org_[A-Za-z0-9]+$/.test(value ?? '')
const sessionId = value => /^session_[A-Za-z0-9]+$/.test(value ?? '')
const eventId = value => typeof value === 'string' && /^event_[A-Za-z0-9]+$/.test(value) && value.length <= 200

function same(left, right) {
  const a = encoder.encode(left), b = encoder.encode(right)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// WorkOS-Signature: t=<milliseconds>, v1=<hex hmac sha256 of `${t}.${rawBody}`>
export async function verifyWorkosWebhook(secret, header, body, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 16 || typeof header !== 'string' || header.length > 512 || typeof body !== 'string') return false
  const parts = Object.fromEntries(header.split(',').map(part => {
    const index = part.indexOf('=')
    return index < 0 ? [] : [part.slice(0, index).trim(), part.slice(index + 1).trim()]
  }).filter(pair => pair.length === 2))
  const issued = Number(parts.t)
  if (!Number.isFinite(issued) || typeof parts.v1 !== 'string' || !/^[0-9a-f]+$/i.test(parts.v1)) return false
  const millis = issued > 1e12 ? issued : issued * 1000
  if (Math.abs(now - millis) > 300000) return false
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${parts.t}.${body}`)))
  const expected = [...mac].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return same(expected, parts.v1.toLowerCase())
}

export async function ensureWorkosWebhookSchema(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS workos_webhook_events (id TEXT PRIMARY KEY, received_at TEXT NOT NULL)').run()
  try { await env.DB.prepare('ALTER TABLE workos_sessions ADD COLUMN provider_session_id TEXT').run() } catch { /* The column is already present. */ }
}

async function seen(env, id) {
  const row = await env.DB.prepare('SELECT id FROM workos_webhook_events WHERE id=?').bind(id).first()
  return Boolean(row)
}

async function remember(env, id) {
  await env.DB.prepare('INSERT OR IGNORE INTO workos_webhook_events(id,received_at) VALUES(?,?)').bind(id, new Date().toISOString()).run()
}

async function revokeUser(env, id) {
  if (!userId(id)) return
  const at = new Date().toISOString()
  await env.DB.prepare("UPDATE users SET status='denied', decided_at=?, decided_by='workos_webhook' WHERE id=? AND status!='denied'").bind(at, id).run()
  await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run()
  await env.DB.prepare('DELETE FROM workos_sessions WHERE user_id=?').bind(id).run()
}

async function revokeProviderSession(env, id) {
  if (!sessionId(id)) return
  const rows = await env.DB.prepare('SELECT session_id FROM workos_sessions WHERE provider_session_id=?').bind(id).all()
  for (const row of rows.results ?? []) await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(row.session_id).run()
  await env.DB.prepare('DELETE FROM workos_sessions WHERE provider_session_id=?').bind(id).run()
}

function ourOrg(env, value) {
  return orgId(env.WORKOS_RBAC_ORGANIZATION_ID) && value === env.WORKOS_RBAC_ORGANIZATION_ID
}

export async function handleWorkosWebhook(request, env, fetcher = fetch) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { 'cache-control': 'no-store' } })
  if (typeof env.WORKOS_WEBHOOK_SECRET !== 'string' || env.WORKOS_WEBHOOK_SECRET.length < 16) return new Response('unavailable', { status: 503, headers: { 'cache-control': 'no-store' } })
  const body = await request.text()
  if (body.length > 65536) return new Response('too large', { status: 413, headers: { 'cache-control': 'no-store' } })
  if (!await verifyWorkosWebhook(env.WORKOS_WEBHOOK_SECRET, request.headers.get('workos-signature'), body)) return new Response('unauthorized', { status: 401, headers: { 'cache-control': 'no-store' } })
  let payload
  try { payload = JSON.parse(body) } catch { return new Response('invalid', { status: 400, headers: { 'cache-control': 'no-store' } }) }
  const id = payload?.id
  const type = payload?.event
  const data = payload?.data
  if (!eventId(id) || typeof type !== 'string' || !data || typeof data !== 'object') return new Response('invalid', { status: 400, headers: { 'cache-control': 'no-store' } })
  try { await ensureWorkosWebhookSchema(env) } catch { return new Response('unavailable', { status: 503, headers: { 'cache-control': 'no-store' } }) }
  if (await seen(env, id)) return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } })
  const handled = ['user.deleted', 'organization_membership.deleted', 'organization_membership.updated', 'session.revoked']
  if (!handled.includes(type)) {
    await remember(env, id)
    return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } })
  }
  if (type === 'user.deleted' && userId(data.id)) await revokeUser(env, data.id)
  if (type === 'organization_membership.deleted' && ourOrg(env, data.organization_id) && userId(data.user_id)) await revokeUser(env, data.user_id)
  if (type === 'organization_membership.updated' && ourOrg(env, data.organization_id) && userId(data.user_id)) {
    const role = typeof data.role?.slug === 'string' ? data.role.slug.slice(0, 80) : ''
    const status = typeof data.status === 'string' ? data.status.slice(0, 40) : ''
    if (status && status !== 'active') await revokeUser(env, data.user_id)
    await emitWorkosAudit(env, { action: 'egm.access.role_changed', actorId: data.user_id, targetId: data.user_id, targetType: 'user', metadata: { role, status, source: 'workos_webhook' } }, request, fetcher)
  }
  if (type === 'session.revoked') await revokeProviderSession(env, data.id)
  await remember(env, id)
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } })
}
