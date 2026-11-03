// WorkOS Audit Logs. Delivery never blocks or fails the dashboard action that triggered it.
// Schemas for these action names must be registered in the WorkOS dashboard before events are accepted.
const userId = value => /^user_[A-Za-z0-9]+$/.test(value ?? '')

export async function emitWorkosAudit(env, event, request, fetcher = fetch) {
  try {
    if (typeof env?.WORKOS_API_KEY !== 'string' || !env.WORKOS_API_KEY || !/^org_[A-Za-z0-9]+$/.test(env.WORKOS_RBAC_ORGANIZATION_ID ?? '')) return false
    if (!/^[a-z][a-z0-9._]{0,80}$/.test(event?.action ?? '') || !userId(event.actorId) || typeof event.targetId !== 'string' || !event.targetId || event.targetId.length > 200) return false
    const ip = request?.headers?.get('cf-connecting-ip')
    const location = typeof ip === 'string' && /^[0-9a-fA-F:.]+$/.test(ip) && ip.length <= 64 ? ip : undefined
    const agent = request?.headers?.get('user-agent')
    const metadata = Object.fromEntries(Object.entries(event.metadata ?? {}).filter(([, value]) => value != null && value !== '').map(([key, value]) => [key, String(value).slice(0, 500)]))
    const body = {
      organization_id: env.WORKOS_RBAC_ORGANIZATION_ID,
      event: {
        action: event.action,
        occurred_at: new Date().toISOString(),
        actor: { id: event.actorId, type: 'user', ...(event.actorName ? { name: String(event.actorName).slice(0, 200) } : {}) },
        targets: [{ id: event.targetId, type: event.targetType === 'invitation' ? 'invitation' : 'user' }],
        context: { ...(location ? { location } : {}), user_agent: (typeof agent === 'string' && agent ? agent : 'egm-dashboard').slice(0, 512) },
        ...(Object.keys(metadata).length ? { metadata } : {}),
      },
    }
    const response = await fetcher('https://api.workos.com/audit_logs/events', {
      method: 'POST',
      redirect: 'manual',
      headers: { authorization: `Bearer ${env.WORKOS_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    await response.body?.cancel?.()
    return response.ok
  } catch { return false }
}

export function scheduleWorkosAudit(env, event, request, waitUntil, fetcher = fetch) {
  const pending = emitWorkosAudit(env, event, request, fetcher)
  waitUntil?.(pending)
  return pending
}
