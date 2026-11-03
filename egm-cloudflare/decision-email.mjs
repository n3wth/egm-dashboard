// One email per person per decision. The row is claimed before Resend is called,
// and the Idempotency-Key repeats that same pair. A later retry finds the row
// and does not send, including after Resend's 24 hour window.
export const decisionSender = 'EGM Dashboard <updates@n3wth.com>'
export const dashboardUrl = 'https://egm.n3wth.com'
// Public after the worker that ships these files is deployed. Email clients fetch them with no session.
export const logoBlackUrl = 'https://egm.n3wth.com/email/egm-mark-black.png'
export const logoWhiteUrl = 'https://egm.n3wth.com/email/egm-mark-white.png'
const logoWidth = 56
const logoHeight = 33
const footerText = 'Sent because you requested access. n3wth.com'

const encoder = new TextEncoder()

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])
}

export function decisionEmailEnabled(env, decision) {
  if (!env?.RESEND_API_KEY || env.DECISION_EMAIL_ENABLED !== 'true') return false
  switch (decision) {
    case 'approved':
      return true
    case 'denied':
      return env.DECISION_DENY_EMAIL_ENABLED === 'true'
    default: {
      const unexpected = decision
      throw Error(`unknown decision ${String(unexpected)}`)
    }
  }
}

function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function decisionIdempotencyKey(userId, decision) {
  const key = `egm-decision/${userId}/${decision}`
  if (/^[\x21-\x7E]{1,256}$/.test(key)) return key
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(key))
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return `egm-decision/${hex}/${decision}`
}

function message(decision) {
  switch (decision) {
    case 'approved':
      return {
        subject: "You're in to the EGM Growth Dashboard",
        heading: "You're in",
        preheader: 'Your access to the EGM Growth Dashboard is approved.',
        paragraphs: ['Your access to the EGM Growth Dashboard is approved.', 'Sign in with the same Google account you used to request access.'],
        emphasizeProduct: true,
        link: { href: dashboardUrl, label: 'Open the dashboard' },
        text: `You're in\n\nYour access to the EGM Growth Dashboard is approved.\n\nOpen the dashboard: ${dashboardUrl}\n\nSign in with the same Google account you used to request access.\n\n--\n${footerText}`
      }
    case 'denied':
      return {
        subject: 'Your EGM Growth Dashboard request was not approved',
        heading: 'Request not approved',
        preheader: 'If you think this is a mistake, ask Oliver to review it.',
        paragraphs: ['Thanks for requesting access to the EGM Growth Dashboard. This account does not have access.', 'If you think this is a mistake, ask Oliver to review it.'],
        emphasizeProduct: false,
        link: null,
        text: `Request not approved\n\nThanks for requesting access to the EGM Growth Dashboard. This account does not have access.\n\nIf you think this is a mistake, ask Oliver to review it.\n\n--\n${footerText}`
      }
    default: {
      const unexpected = decision
      throw Error(`unknown decision ${String(unexpected)}`)
    }
  }
}

const font = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`

function emphasizeProduct(text) {
  const name = 'EGM Growth Dashboard'
  const index = text.indexOf(name)
  if (index < 0) return escapeHtml(text)
  return `${escapeHtml(text.slice(0, index))}<strong>${escapeHtml(name)}</strong>${escapeHtml(text.slice(index + name.length))}`
}

function bodyParagraph(html, marginBottom) {
  const margin = marginBottom ? `0 0 ${marginBottom}px` : '0'
  return `<p class="text" style="margin:${margin};font-size:14px;line-height:24px;text-align:center;color:#000000">${html}</p>`
}

function logoMark() {
  const light = `<img class="logo-light" src="${logoBlackUrl}" width="${logoWidth}" height="${logoHeight}" alt="EGM" style="display:block;margin:0 auto;width:${logoWidth}px;height:${logoHeight}px;border:0">`
  const dark = `<img class="logo-dark" src="${logoWhiteUrl}" width="${logoWidth}" height="${logoHeight}" alt="EGM" style="display:none;max-height:0;overflow:hidden;margin:0 auto;width:${logoWidth}px;height:${logoHeight}px;border:0">`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:0 0 28px">${light}${dark}</td></tr></table>`
}

function dashboardButton(link) {
  const href = escapeHtml(link.href)
  const label = escapeHtml(link.label)
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 24px"><tr><td class="button" align="center" style="border-radius:6px"><a href="${href}" style="display:inline-block;padding:12px 20px;border-radius:6px;background-color:#000000;color:#ffffff;font-size:14px;font-weight:600;line-height:20px;text-decoration:none">${label}</a></td></tr></table>`
}

function footer() {
  return `<hr class="rule" style="margin:28px 0;border:none;border-top:1px solid #eaeaea;width:100%"><p class="muted" style="margin:0;font-size:12px;line-height:24px;text-align:center;color:#666666">Sent because you requested access. <a href="https://n3wth.com" class="muted" style="color:#666666;text-decoration:underline">n3wth.com</a></p>`
}

function document({ subject, heading, preheader, paragraphs, emphasizeProduct: markProduct, link }) {
  const htmlParagraphs = paragraphs.map((text, index) => markProduct && index === 0 ? emphasizeProduct(text) : escapeHtml(text))
  const [first, ...rest] = htmlParagraphs
  const blocks = [bodyParagraph(first, rest.length || link ? 24 : 0)]
  if (link) blocks.push(dashboardButton(link))
  rest.forEach((html, index) => blocks.push(bodyParagraph(html, index === rest.length - 1 ? 0 : 24)))
  const styles = `:root{color-scheme:light dark;supported-color-schemes:light dark}body{margin:0;background:transparent;background-color:transparent}.logo-dark{display:none !important;max-height:0;overflow:hidden}@media (prefers-color-scheme:dark){.heading,.text{color:#f5f5f5 !important}.muted{color:#a6a6a6 !important}.card{border-color:#333333 !important}.rule{border-top-color:#333333 !important}.logo-light{display:none !important}.logo-dark{display:block !important;max-height:none !important;overflow:visible !important}.button a{background-color:#ffffff !important;color:#000000 !important}}`
  return `<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(subject)}</title><style>${styles}</style></head><body style="margin:0;padding:0;background:transparent;background-color:transparent;font-family:${font}"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:transparent;background-color:transparent"><tr><td align="center" style="padding:40px 12px"><table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:465px;border:1px solid #eaeaea;border-radius:8px;border-collapse:separate"><tr><td style="padding:32px 28px">${logoMark()}<h1 class="heading" style="margin:0 0 24px;font-size:24px;line-height:32px;font-weight:600;text-align:center;color:#000000">${escapeHtml(heading)}</h1>${blocks.join('')}${footer()}</td></tr></table></td></tr></table></body></html>`
}

export function decisionEmail(decision) {
  const copy = message(decision)
  return { subject: copy.subject, text: copy.text, html: document(copy) }
}

export function decisionEmailPreview(decision, scheme) {
  const { html } = decisionEmail(decision)
  let chrome
  let forced
  switch (scheme) {
    case 'light':
      chrome = '#ffffff'
      forced = '.heading,.text{color:#000000 !important}.muted{color:#666666 !important}.card{border-color:#eaeaea !important}.rule{border-top-color:#eaeaea !important}.logo-light{display:block !important;max-height:none !important}.logo-dark{display:none !important;max-height:0 !important}.button a{background-color:#000000 !important;color:#ffffff !important}'
      break
    case 'dark':
      chrome = '#181818'
      forced = '.heading,.text{color:#f5f5f5 !important}.muted{color:#a6a6a6 !important}.card{border-color:#333333 !important}.rule{border-top-color:#333333 !important}.logo-light{display:none !important}.logo-dark{display:block !important;max-height:none !important;overflow:visible !important}.button a{background-color:#ffffff !important;color:#000000 !important}'
      break
    default: {
      const unexpected = scheme
      throw Error(`unknown scheme ${String(unexpected)}`)
    }
  }
  const style = `<style>html{background-color:${chrome}}body{background:transparent !important;background-color:transparent !important}${forced}</style>`
  return `<!-- Preview chrome only. The html background stands in for the mail client. The message body and container stay transparent. -->${html.replace('</head>', `${style}</head>`)}`
}

async function claim(env, userId, decision, state) {
  const result = await env.DB.prepare("INSERT OR IGNORE INTO decision_notifications(user_id,decision,state,claimed_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND status=?)").bind(userId, decision, state, new Date().toISOString(), userId, decision).run()
  return result.meta?.changes === 1
}

async function settle(env, userId, decision, state, providerId = null) {
  await env.DB.prepare('UPDATE decision_notifications SET state=?,sent_at=?,provider_id=? WHERE user_id=? AND decision=? AND state=?').bind(state, state === 'sent' ? new Date().toISOString() : null, providerId, userId, decision, 'claimed').run()
}

// fromStatus must be the status observed before a successful update. Calls
// without a pending transition return before any read or send, so existing
// decisions are never backfilled.
export async function notifyAccessDecision(env, input, fetcher = fetch) {
  const decision = input?.decision
  const userId = input?.userId
  if (input?.fromStatus !== 'pending') return
  if (decision !== 'approved' && decision !== 'denied') return
  if (typeof userId !== 'string' || !userId || userId.length > 200) return
  let accepted = false
  try {
    const user = await env.DB.prepare('SELECT email,status FROM users WHERE id=?').bind(userId).first()
    if (!user || user.status !== decision) return
    const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : ''
    if (!decisionEmailEnabled(env, decision)) {
      await claim(env, userId, decision, 'skipped')
      return
    }
    if (!validEmail(email)) {
      if (await claim(env, userId, decision, 'failed')) console.error('Decision email failed', decision, 'invalid_email')
      return
    }
    if (!await claim(env, userId, decision, 'claimed')) return
    const current = await env.DB.prepare('SELECT status FROM users WHERE id=?').bind(userId).first()
    if (current?.status !== decision) {
      await settle(env, userId, decision, 'skipped')
      return
    }
    const idempotencyKey = await decisionIdempotencyKey(userId, decision)
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ from: decisionSender, to: [email], ...decisionEmail(decision) }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000)
    })
    if (!response.ok) {
      await response.text().catch(() => {})
      console.error('Decision email failed', decision, response.status)
      await settle(env, userId, decision, 'failed')
      return
    }
    accepted = true
    let providerId = null
    try {
      const item = await response.json()
      if (typeof item.id === 'string' && item.id && item.id.length <= 200) providerId = item.id
    } catch {}
    await settle(env, userId, decision, 'sent', providerId)
  } catch {
    console.error('Decision email failed', decision, accepted ? 'unrecorded' : 'unavailable')
    if (!accepted) {
      try { await settle(env, userId, decision, 'failed') } catch { console.error('Decision email failed', decision, 'unavailable') }
    }
  }
}
