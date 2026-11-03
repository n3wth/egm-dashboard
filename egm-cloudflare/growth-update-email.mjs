import seed from '../egm-performance/src/data.json' with { type: 'json' }
import { decisionSender, dashboardUrl, logoBlackUrl, logoWhiteUrl } from './decision-email.mjs'

export const defaultGrowthRecipient = 'newth@google.com'

const font = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])
}

function formatInt(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : 'Unavailable'
}

export function extractGrowthSummary(snapshot) {
  const queries = snapshot?.queries ?? seed?.queries ?? {}
  const reach = queries.reach?.rows?.[0] ?? seed?.queries?.reach?.rows?.[0] ?? {}
  const web = queries.website?.rows?.[0] ?? seed?.queries?.website?.rows?.[0] ?? {}
  const briefQuery = queries.weekly_brief?.rows?.length ? queries.weekly_brief : (seed?.queries?.weekly_brief ?? {})
  const briefMeta = briefQuery.metadata ?? {}
  const briefRows = Array.isArray(briefQuery.rows) ? briefQuery.rows : []
  const ossMetrics = queries.oss_health?.metrics ?? seed?.queries?.oss_health?.metrics ?? {}
  const ossRow = queries.oss_health?.rows?.[0] ?? {}

  const starHistoryRows = queries.star_history?.rows ?? seed?.queries?.star_history?.rows ?? []
  const starObsRows = queries.star_observations?.rows ?? seed?.queries?.star_observations?.rows ?? []
  const starCandidates = [reach.stars, starObsRows.at(-1)?.stars, starHistoryRows.at(-1)?.stars].filter(Number.isFinite)
  const latestStars = starCandidates.length ? Math.max(...starCandidates) : 10879
  const sevenDaysAgoRow = starHistoryRows.length >= 8 ? starHistoryRows[starHistoryRows.length - 8] : null
  const sevenDayStarDelta = Number.isFinite(latestStars) && Number.isFinite(sevenDaysAgoRow?.stars)
    ? latestStars - sevenDaysAgoRow.stars
    : null

  const referrers = (queries.referrers?.rows ?? seed?.queries?.referrers?.rows ?? [])
    .slice(0, 5)
    .map(row => `${row.source} (${formatInt(row.views ?? row.count)})`)
    .join(', ')

  const verifiedItems = briefRows.filter(row => row.section === 'improved' && row.stage === 'user-verified')
  const attentionItems = briefRows.filter(row => row.section === 'attention')
  const commitments = briefRows.filter(row => row.section === 'commitments')
  const verifiedCommitments = commitments.filter(row => row.outcome === 'verified').length

  return {
    isoWeek: briefMeta.isoWeek || '2026-W44',
    latestRelease: briefMeta.latestRelease || ossMetrics.latestRelease || 'v0.1.0',
    headline: briefMeta.headline || 'Release v0.1.0 lags main by 24 in-window merged PRs; first-time users hit slash-command and strict-validator blockers already fixed or tracked on main.',
    implication: briefMeta.implication || 'Cutting a patch release (v0.1.1) and resolving stage-1 plugin packaging (#272) unblocks Antigravity and Claude Code evaluators without adding product telemetry.',
    stars: latestStars,
    sevenDayStarDelta,
    forks: reach.forks ?? 724,
    visitors: reach.visitors ?? 57442,
    views: reach.views ?? 131259,
    cloners: reach.cloners ?? 22427,
    clones: reach.clones ?? 61724,
    websiteReferralViews: web.referralViews ?? 4825,
    websiteReferralVisitors: web.referralVisitors ?? 3153,
    openIssues: ossRow.openIssues ?? ossMetrics.openIssues ?? 40,
    openPRs: ossRow.openPRs ?? ossMetrics.openPRs ?? 20,
    unreleasedMergedPRs: ossRow.unreleasedMergedPRs ?? ossMetrics.unreleasedMergedPRs ?? 24,
    referrers,
    verifiedCommitments,
    totalCommitments: commitments.length || 4,
    verifiedItems,
    attentionItems,
    reviewIssueUrl: briefMeta.reviewIssueUrl || 'https://github.com/n3wth/egm-dashboard/issues/132'
  }
}

export function buildGrowthUpdateEmail(snapshot) {
  const s = extractGrowthSummary(snapshot)
  const starDeltaText = Number.isFinite(s.sevenDayStarDelta) && s.sevenDayStarDelta > 0
    ? ` (+${formatInt(s.sevenDayStarDelta)} over 7 days)`
    : ''
  const subject = `EGM Growth & Weekly Brief (${s.isoWeek}): ${formatInt(s.stars)} stars${starDeltaText}`
  const preheader = `${formatInt(s.stars)} stars, ${formatInt(s.visitors)} unique visitors (14d), ${formatInt(s.cloners)} unique cloners, and ${s.isoWeek} maintainer brief.`

  const textLines = [
    `EGM Growth & Weekly Building Brief (${s.isoWeek})`,
    '',
    `Summary: ${s.headline}`,
    `Next step: ${s.implication}`,
    '',
    'Growth snapshot (14-day rolling GitHub window):',
    `- Total stars: ${formatInt(s.stars)}${starDeltaText} (${formatInt(s.forks)} forks)`,
    `- Repo traffic: ${formatInt(s.visitors)} unique visitors / ${formatInt(s.views)} views`,
    `- Git clones: ${formatInt(s.cloners)} unique cloners / ${formatInt(s.clones)} clone operations`,
    `- egm.dev referrals: ${formatInt(s.websiteReferralVisitors)} unique visitors / ${formatInt(s.websiteReferralViews)} views`,
    ...(s.referrers ? [`- Top referrers: ${s.referrers}`] : []),
    '',
    `Weekly Building Brief (${s.isoWeek}):`,
    `- Commitments verified: ${s.verifiedCommitments} of ${s.totalCommitments} verified`,
    `- Release cutline: ${s.unreleasedMergedPRs} merged PRs on main since ${s.latestRelease} (${s.openIssues} open issues, ${s.openPRs} open PRs)`,
    ...s.verifiedItems.map(item => `- User-verified fix: ${item.title} (${item.evidence})`),
    ...s.attentionItems.map(item => `- Needs attention (${item.severity}): ${item.title} - ${item.nextAction}`),
    '',
    `Open the dashboard: ${dashboardUrl}`,
    `Weekly Building Brief: ${dashboardUrl}/development`,
    `Review issue: ${s.reviewIssueUrl}`,
    '',
    '--',
    'EGM Growth Dashboard · egm.n3wth.com'
  ]

  const metricRows = [
    ['Total stars', `${formatInt(s.stars)}${starDeltaText} · ${formatInt(s.forks)} forks`],
    ['Repo traffic (14d)', `${formatInt(s.visitors)} unique visitors · ${formatInt(s.views)} views`],
    ['Git clones (14d)', `${formatInt(s.cloners)} unique cloners · ${formatInt(s.clones)} clones`],
    ['egm.dev referrals (14d)', `${formatInt(s.websiteReferralVisitors)} visitors · ${formatInt(s.websiteReferralViews)} views`],
    ['Release cutline', `${s.unreleasedMergedPRs} merged PRs unreleased since ${s.latestRelease}`],
    ['Commitments status', `${s.verifiedCommitments} of ${s.totalCommitments} prior commitments verified`]
  ]

  const metricsHtml = metricRows.map(([label, val]) => (
    `<tr>` +
    `<td class="cell-label" style="padding:8px 10px;border-bottom:1px solid #eaeaea;font-size:13px;line-height:18px;color:#555555;text-align:left">${escapeHtml(label)}</td>` +
    `<td class="cell-val" style="padding:8px 10px;border-bottom:1px solid #eaeaea;font-size:13px;line-height:18px;color:#000000;text-align:right;font-variant-numeric:tabular-nums">${escapeHtml(val)}</td>` +
    `</tr>`
  )).join('')

  const verifiedHtml = s.verifiedItems.map(item => (
    `<li style="margin:0 0 8px;font-size:13px;line-height:20px;color:#000000">` +
    `<strong>${escapeHtml(item.title)}:</strong> ${escapeHtml(item.evidence)}` +
    `</li>`
  )).join('')

  const attentionHtml = s.attentionItems.map(item => (
    `<li style="margin:0 0 8px;font-size:13px;line-height:20px;color:#000000">` +
    `<strong>${escapeHtml(item.title)} (${escapeHtml(item.severity)}):</strong> ${escapeHtml(item.nextAction)}` +
    `</li>`
  )).join('')

  const styles = `:root{color-scheme:light dark;supported-color-schemes:light dark}body{margin:0;background:transparent;background-color:transparent}.logo-dark{display:none !important;max-height:0;overflow:hidden}@media (prefers-color-scheme:dark){.heading,.text,.cell-val,li{color:#f5f5f5 !important}.muted,.cell-label{color:#a6a6a6 !important}.card,.table-box{border-color:#333333 !important}.cell-label,.cell-val{border-bottom-color:#333333 !important}.callout{background-color:#1f1f1f !important;border-color:#333333 !important}.rule{border-top-color:#333333 !important}.logo-light{display:none !important}.logo-dark{display:block !important;max-height:none !important;overflow:visible !important}.button a{background-color:#ffffff !important;color:#000000 !important}}`

  const html = `<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(subject)}</title><style>${styles}</style></head><body style="margin:0;padding:0;background:transparent;background-color:transparent;font-family:${font}"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:transparent;background-color:transparent"><tr><td align="center" style="padding:32px 12px"><table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;border:1px solid #eaeaea;border-radius:8px;border-collapse:separate"><tr><td style="padding:32px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:0 0 20px"><img class="logo-light" src="${logoBlackUrl}" width="56" height="33" alt="EGM" style="display:block;margin:0 auto;width:56px;height:33px;border:0"><img class="logo-dark" src="${logoWhiteUrl}" width="56" height="33" alt="EGM" style="display:none;max-height:0;overflow:hidden;margin:0 auto;width:56px;height:33px;border:0"></td></tr></table><p class="muted" style="margin:0 0 6px;font-size:12px;line-height:18px;text-align:center;color:#666666;text-transform:uppercase;letter-spacing:0.05em">Weekly Growth &amp; Building Brief · ${escapeHtml(s.isoWeek)}</p><h1 class="heading" style="margin:0 0 20px;font-size:22px;line-height:30px;font-weight:600;text-align:center;color:#000000">${escapeHtml(formatInt(s.stars))} stars${escapeHtml(starDeltaText)}</h1><div class="callout" style="margin:0 0 20px;padding:14px 16px;border:1px solid #eaeaea;border-radius:6px;background-color:#fafafa"><p class="text" style="margin:0 0 8px;font-size:13px;line-height:20px;color:#000000"><strong>Key takeaway:</strong> ${escapeHtml(s.headline)}</p><p class="text" style="margin:0;font-size:13px;line-height:20px;color:#000000"><strong>Implication:</strong> ${escapeHtml(s.implication)}</p></div><table role="presentation" class="table-box" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border:1px solid #eaeaea;border-radius:6px;border-collapse:separate;overflow:hidden">${metricsHtml}</table>${verifiedHtml ? `<h2 class="heading" style="margin:0 0 8px;font-size:14px;line-height:20px;font-weight:600;color:#000000">User-verified improvements</h2><ul style="margin:0 0 18px;padding-left:18px">${verifiedHtml}</ul>` : ''}${attentionHtml ? `<h2 class="heading" style="margin:0 0 8px;font-size:14px;line-height:20px;font-weight:600;color:#000000">Needs attention</h2><ul style="margin:0 0 22px;padding-left:18px">${attentionHtml}</ul>` : ''}<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 16px"><tr><td class="button" align="center" style="border-radius:6px"><a href="${dashboardUrl}/development" style="display:inline-block;padding:12px 20px;border-radius:6px;background-color:#000000;color:#ffffff;font-size:14px;font-weight:600;line-height:20px;text-decoration:none">Open the dashboard</a></td></tr></table><p class="muted" style="margin:0;font-size:12px;line-height:20px;text-align:center;color:#666666"><a href="${dashboardUrl}" class="muted" style="color:#666666;text-decoration:underline">Overview &amp; star velocity</a> · <a href="${dashboardUrl}/adoption" class="muted" style="color:#666666;text-decoration:underline">Adoption &amp; retest log</a> · <a href="${escapeHtml(s.reviewIssueUrl)}" class="muted" style="color:#666666;text-decoration:underline">GitHub review issue</a></p><hr class="rule" style="margin:24px 0 16px;border:none;border-top:1px solid #eaeaea;width:100%"><p class="muted" style="margin:0;font-size:12px;line-height:20px;text-align:center;color:#666666">EGM Growth Dashboard · <a href="${dashboardUrl}" class="muted" style="color:#666666;text-decoration:underline">egm.n3wth.com</a></p></td></tr></table></td></tr></table></body></html>`

  return { subject, text: textLines.join('\n'), html, isoWeek: s.isoWeek }
}

async function ensureGrowthEmailTable(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS growth_update_emails (id TEXT PRIMARY KEY, recipient TEXT NOT NULL, state TEXT NOT NULL, provider_id TEXT, claimed_at TEXT NOT NULL, sent_at TEXT)'
  ).run()
}

async function loadCurrentSnapshot(env) {
  try {
    const row = await env.DB.prepare("SELECT json_remove(body,'$.githubHistory') AS body FROM snapshots WHERE id=1").first()
    if (row?.body) {
      const parsed = JSON.parse(row.body)
      if (parsed && typeof parsed === 'object') {
        parsed.queries = { ...seed.queries, ...(parsed.queries ?? {}) }
        return parsed
      }
    }
  } catch {}
  return seed
}

export async function sendGrowthUpdateEmail(env, { recipient = defaultGrowthRecipient, idempotencySuffix = 'initial', force = false } = {}, fetcher = fetch) {
  if (!env?.RESEND_API_KEY) return { status: 'missing_api_key' }
  const cleanRecipient = String(recipient).trim().toLowerCase()
  if (cleanRecipient !== defaultGrowthRecipient) return { status: 'recipient_not_allowed' }

  await ensureGrowthEmailTable(env)
  const snapshot = await loadCurrentSnapshot(env)
  const email = buildGrowthUpdateEmail(snapshot)
  const recordId = `${email.isoWeek}:${cleanRecipient}:${idempotencySuffix}`
  const nowIso = new Date().toISOString()

  if (!force) {
    const existing = await env.DB.prepare('SELECT state, provider_id, sent_at FROM growth_update_emails WHERE id=?').bind(recordId).first()
    if (existing?.state === 'sent') {
      return { status: 'already_sent', id: recordId, providerId: existing.provider_id, sentAt: existing.sent_at }
    }
    const claim = await env.DB.prepare(
      "INSERT INTO growth_update_emails(id, recipient, state, claimed_at) VALUES(?, ?, 'claimed', ?) ON CONFLICT(id) DO UPDATE SET state='claimed', claimed_at=excluded.claimed_at WHERE growth_update_emails.state='failed'"
    ).bind(recordId, cleanRecipient, nowIso).run()
    if (claim.meta?.changes !== 1) {
      return { status: 'in_progress_or_sent', id: recordId }
    }
  } else {
    await env.DB.prepare(
      "INSERT INTO growth_update_emails(id, recipient, state, claimed_at) VALUES(?, ?, 'claimed', ?) ON CONFLICT(id) DO UPDATE SET state='claimed', claimed_at=excluded.claimed_at"
    ).bind(recordId, cleanRecipient, nowIso).run()
  }

  const idempotencyKey = `egm-growth-update/${recordId}`.replace(/[^A-Za-z0-9_/:.-]/g, '-')
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey
      },
      body: JSON.stringify({
        from: decisionSender,
        to: [cleanRecipient],
        subject: email.subject,
        text: email.text,
        html: email.html
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000)
    })
    if (!response.ok) {
      await response.text().catch(() => {})
      await env.DB.prepare("UPDATE growth_update_emails SET state='failed' WHERE id=?").bind(recordId).run()
      return { status: 'failed', httpStatus: response.status, id: recordId }
    }
    let providerId = null
    try {
      const payload = await response.json()
      if (typeof payload?.id === 'string') providerId = payload.id
    } catch {}
    const sentAt = new Date().toISOString()
    await env.DB.prepare("UPDATE growth_update_emails SET state='sent', provider_id=?, sent_at=? WHERE id=?").bind(providerId, sentAt, recordId).run()
    return { status: 'sent', id: recordId, providerId, sentAt, subject: email.subject }
  } catch {
    try {
      await env.DB.prepare("UPDATE growth_update_emails SET state='failed' WHERE id=?").bind(recordId).run()
    } catch {}
    return { status: 'failed', id: recordId }
  }
}
