import {readBody} from './request-body.mjs'
import {scheduleWorkosAudit} from './workos-audit-log.mjs'
const encoder = new TextEncoder()
const reply = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
export const validInvitationToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{16,512}$/.test(token)
export async function invitationHash(token) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))), byte => byte.toString(16).padStart(2, '0')).join('')
}

function emailConfigured(env) {
  return Boolean(env.RESEND_API_KEY && env.INVITATION_EMAIL_ENABLED === 'true')
}

function invitationEmail(url, days) {
  const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const subject = 'Invitation to the EGM Growth Dashboard'
  const text = `You've been invited to the EGM Growth Dashboard.\n\nOpen your invitation: ${url}\n\nThis link expires in ${days} ${days === 1 ? 'day' : 'days'} and can be used once. Sign in with the Google account for the invited email address.\n\nIf you weren't expecting this invitation, you can ignore this email.\n\nn3wth.com`
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px 0;line-height:1.6"><p style="margin:0 0 24px;font-size:14px;font-weight:700;letter-spacing:.04em">EGM</p><h1 style="font-size:24px;line-height:1.25;margin:0 0 16px">You're invited</h1><p style="margin:0 0 16px">You've been invited to the EGM Growth Dashboard.</p><p style="margin:0 0 20px"><a href="${safeUrl}" style="color:#1b6ef3;font-weight:600">Open your invitation</a></p><p style="margin:0 0 16px">This link expires in ${days} ${days === 1 ? 'day' : 'days'} and can be used once. Sign in with the Google account for the invited email address.</p><p style="margin:0 0 32px">If you weren't expecting this invitation, you can ignore this email.</p><p style="margin:0;font-size:13px;color:#5b5b5b">n3wth.com</p></div>`
  return { subject, text, html }
}

export async function manageInvitations(request, env, user, fetcher = fetch) {
  if (!user || user.status !== 'approved' || user.verified !== 1 || (env.WORKOS_RBAC_ENABLED === 'true' ? user.canManageAccess !== true : !isDashboardOwner(user, env))) return reply({ error: 'owner_required' }, 403)
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/api/invitations') {
    const result = await env.DB.prepare('SELECT id,email,kind,created_at,expires_at,redeemed_at,revoked_at,delivery_state FROM invitations ORDER BY created_at DESC LIMIT 100').all()
    return reply({ emailAvailable: emailConfigured(env), invitations: result.results.map(row => ({ id: row.id, email: row.email, kind: row.kind, deliveryState: row.delivery_state, expiresAt: new Date(row.expires_at).toISOString(), redeemedAt: row.redeemed_at ? new Date(row.redeemed_at).toISOString() : null, revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null })) })
  }
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405)
  if (request.headers.get('origin') !== env.APP_URL) return reply({ error: 'invalid_origin' }, 403)
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'json_required' }, 415)
  const body = await readBody(request, 2048)
  if (body === null) return reply({ error: 'too_large' }, 413)
  let input
  try { input = JSON.parse(body) } catch { return reply({ error: 'invalid_request' }, 400) }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return reply({ error: 'invalid_request' }, 400)
  if (url.pathname === '/api/invitations/revoke') {
    if (Object.keys(input).some(key => key !== 'id') || typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/.test(input.id)) return reply({ error: 'invalid_request' }, 400)
    const result = await env.DB.prepare('UPDATE invitations SET revoked_at=? WHERE id=? AND redeemed_at IS NULL AND revoked_at IS NULL').bind(Date.now(), input.id).run()
    if (result.meta?.changes !== 1) return reply({ error: 'not_active' }, 409)
    scheduleWorkosAudit(env, { action: 'egm.invitation.revoked', actorId: user.id, actorName: user.name, targetId: input.id, targetType: 'invitation' }, request)
    return reply({ ok: true })
  }
  if (url.pathname !== '/api/invitations' || Object.keys(input).some(key => !['kind', 'email', 'expiresInDays'].includes(key)) || !['link', 'email'].includes(input.kind) || ![1, 7, 30].includes(input.expiresInDays)) return reply({ error: 'invalid_request' }, 400)
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (input.kind === 'email' && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return reply({ error: 'invalid_email' }, 400)
  if (input.kind === 'link' && input.email != null) return reply({ error: 'invalid_request' }, 400)
  const token = random(), expiresAt = Date.now() + input.expiresInDays * 86400000
  if (input.kind === 'email') {
    if (!emailConfigured(env)) return reply({ error: 'email_not_configured' }, 503)
    const id = crypto.randomUUID(), now = Date.now()
    try {
      await env.DB.prepare("UPDATE invitations SET revoked_at=? WHERE kind='email' AND email=? AND expires_at<=? AND redeemed_at IS NULL AND revoked_at IS NULL").bind(now, email, now).run()
      await env.DB.prepare("INSERT INTO invitations(id,token_hash,email,kind,created_by,created_at,expires_at,delivery_state) VALUES(?,?,?,'email',?,?,?,'sending')").bind(id, await invitationHash(token), email, user.id, now, expiresAt).run()
    } catch { return reply({ error: 'invitation_exists_or_save_failed' }, 409) }
    try {
      const inviteUrl = `${env.APP_URL}/auth/invite?invitation_token=${encodeURIComponent(token)}`
      const response = await fetcher('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': `egm-invitation/${id}` }, body: JSON.stringify({ from: 'EGM Dashboard <updates@n3wth.com>', to: [email], ...invitationEmail(inviteUrl, input.expiresInDays) }), redirect: 'manual', signal: AbortSignal.timeout(10000) })
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status)) {
          await env.DB.prepare("UPDATE invitations SET delivery_state='failed',revoked_at=? WHERE id=? AND delivery_state='sending'").bind(Date.now(), id).run()
          return reply({ error: 'email_delivery_rejected' }, 502)
        }
        throw Error('delivery_unknown')
      }
      const item = await response.json()
      if (typeof item.id !== 'string' || !item.id || item.id.length > 200) throw Error('delivery_unknown')
      const saved = await env.DB.prepare("UPDATE invitations SET provider_id=?,delivery_state='sent' WHERE id=? AND delivery_state='sending' AND redeemed_at IS NULL AND revoked_at IS NULL").bind(item.id, id).run()
      if (saved.meta?.changes !== 1) throw Error('delivery_unknown')
      scheduleWorkosAudit(env, { action: 'egm.invitation.created', actorId: user.id, actorName: user.name, targetId: id, targetType: 'invitation', metadata: { kind: 'email', email } }, request)
      return reply({ id, expiresAt: new Date(expiresAt).toISOString(), deliveryState: 'sent' }, 201)
    } catch {
      try { await env.DB.prepare("UPDATE invitations SET delivery_state='unknown' WHERE id=? AND delivery_state='sending'").bind(id).run() } catch {}
      scheduleWorkosAudit(env, { action: 'egm.invitation.created', actorId: user.id, actorName: user.name, targetId: id, targetType: 'invitation', metadata: { kind: 'email', email, delivery: 'unknown' } }, request)
      return reply({ id, error: 'email_delivery_unknown' }, 202)
    }
  }
  const id = crypto.randomUUID()
  try {
    await env.DB.prepare('INSERT INTO invitations(id,token_hash,email,kind,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').bind(id, await invitationHash(token), email || null, input.kind, user.id, Date.now(), expiresAt).run()
  } catch { return reply({ error: 'invitation_save_failed' }, 503) }
  const result = { id, expiresAt: new Date(expiresAt).toISOString() }
  if (input.kind === 'link') result.url = `${env.APP_URL}/auth/invite?invitation_token=${encodeURIComponent(token)}`
  scheduleWorkosAudit(env, { action: 'egm.invitation.created', actorId: user.id, actorName: user.name, targetId: id, targetType: 'invitation', metadata: { kind: input.kind } }, request)
  return reply(result, 201)
}

// The D1 batch is transactional. The redemption nonce ties the user mutation
// to this exact successful single-use claim, including concurrent attempts.
export async function redeemInvitation(env, token, user) {
  if (!validInvitationToken(token) || !user?.id || !user.email_verified || typeof user.email !== 'string') return false
  const email = user.email.trim().toLowerCase(), now = Date.now(), nonce = crypto.randomUUID(), at = new Date(now).toISOString()
  const hash = await invitationHash(token)
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE invitations SET redeemed_at=?,redeemed_by=?,redemption_id=? WHERE token_hash=? AND expires_at>? AND redeemed_at IS NULL AND revoked_at IS NULL AND (email IS NULL OR email=?) AND NOT EXISTS (SELECT 1 FROM users WHERE (id=? OR email=?) AND (status='denied' OR id<>? OR email<>?))").bind(now, user.id, nonce, hash, now, email, user.id, email, user.id, email),
    env.DB.prepare("INSERT OR IGNORE INTO users(id,email,name,verified,status,created_at,decided_at,decided_by) SELECT ?,?,?,1,'approved',?,?,created_by FROM invitations WHERE token_hash=? AND redemption_id=?").bind(user.id, email, [user.first_name, user.last_name].filter(Boolean).join(' ') || email, at, at, hash, nonce),
    env.DB.prepare("UPDATE users SET status='approved',decided_at=?,decided_by=(SELECT created_by FROM invitations WHERE token_hash=? AND redemption_id=?) WHERE id=? AND email=? AND status='pending' AND EXISTS(SELECT 1 FROM invitations WHERE token_hash=? AND redemption_id=?)").bind(at, hash, nonce, user.id, email, hash, nonce),
    env.DB.prepare("INSERT INTO audit(id,user_id,action,actor,created_at) SELECT ?,?,'invitation_approved',created_by,? FROM invitations WHERE token_hash=? AND redemption_id=?").bind(crypto.randomUUID(), user.id, at, hash, nonce)
  ])
  return results[0].meta?.changes === 1
}
// True only when a still-active invitation is addressed to another email, so the page can say so without revealing which one.
export async function invitationForOtherAccount(env, token, user) {
  if (!validInvitationToken(token) || typeof user?.email !== 'string') return false
  const row = await env.DB.prepare('SELECT email FROM invitations WHERE token_hash=? AND expires_at>? AND redeemed_at IS NULL AND revoked_at IS NULL').bind(await invitationHash(token), Date.now()).first()
  return Boolean(row?.email) && row.email !== user.email.trim().toLowerCase()
}
import { isDashboardOwner } from './owner-identity.mjs'
