import seed from '../egm-performance/src/data.json' with { type: 'json' }
import { decisionSender, dashboardUrl, logoBlackUrl, logoWhiteUrl } from './decision-email.mjs'
import { GEMINI_MODEL, geminiRunner } from './gemini.mjs'

export const defaultGrowthRecipient = 'newth@google.com'
export const repoUrl = 'https://github.com/google/elephant-goldfish-model'
export const websiteUrl = 'https://egm.dev'
export const growthChartLightUrl = `${dashboardUrl}/email/growth-chart-light.png?v=7`
export const growthChartDarkUrl = `${dashboardUrl}/email/growth-chart-dark.png?v=7`
export const defaultUnsubscribeUrl = `${dashboardUrl}/email/unsubscribe`

const font = `'Suisse Intl',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`
const enc = new TextEncoder()
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const un64 = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
const hmacKey = secret => crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

export async function createUnsubscribeToken(email, secret) {
  const cleanEmail = String(email ?? '').trim().toLowerCase()
  const activeSecret = [].concat(secret).find(s => typeof s === 'string' && s.length > 0) || 'egm-growth-unsubscribe-default'
  const payload = b64(enc.encode(JSON.stringify({ email: cleanEmail, aud: 'growth_unsubscribe' })))
  const sig = b64(await crypto.subtle.sign('HMAC', await hmacKey(activeSecret), enc.encode(payload)))
  return `${payload}.${sig}`
}

export async function verifyUnsubscribeToken(token, secrets) {
  try {
    if (typeof token !== 'string' || !token.includes('.') || token.length > 2048) return null
    const [payload, sig, ...extra] = token.split('.')
    if (extra.length || !payload || !sig) return null
    const candidateSecrets = [].concat(secrets).filter(s => typeof s === 'string' && s.length > 0)
    if (!candidateSecrets.length) candidateSecrets.push('egm-growth-unsubscribe-default')
    let valid = false
    for (const secret of candidateSecrets) {
      if (await crypto.subtle.verify('HMAC', await hmacKey(secret), un64(sig), enc.encode(payload))) {
        valid = true
        break
      }
    }
    if (!valid) return null
    const parsed = JSON.parse(new TextDecoder().decode(un64(payload)))
    if (parsed?.aud !== 'growth_unsubscribe' || typeof parsed?.email !== 'string' || !parsed.email.includes('@')) return null
    return parsed.email.trim().toLowerCase()
  } catch {
    return null
  }
}

export async function buildUnsubscribeUrl(email, secret) {
  const token = await createUnsubscribeToken(email, secret)
  return `${defaultUnsubscribeUrl}?token=${encodeURIComponent(token)}`
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])
}

function formatInt(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : 'Unavailable'
}

function safeHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

export function linkifyRepoText(rawText, linkClass = 'muted-link', linkStyle = 'color:#767676;text-decoration:underline;text-underline-offset:3px') {
  const cleaned = String(rawText ?? '').replace(/(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}Z/g, '$1 UTC')
  const escaped = escapeHtml(cleaned)
  return escaped.replace(
    /\b(PR|Issue)\s+#(\d+)\b|(?<![/\w])#(\d+)\b|\b(v0\.1\.\d+)\b|(?<![\w/])@([A-Za-z0-9-]+)\b/g,
    (match, kind, kindNum, bareNum, versionTag, handle) => {
      if (kind && kindNum) {
        const segment = kind === 'PR' ? 'pull' : 'issues'
        return `<a href="${repoUrl}/${segment}/${kindNum}" class="${linkClass}" style="${linkStyle}">${kind} #${kindNum}</a>`
      }
      if (bareNum) {
        return `<a href="${repoUrl}/issues/${bareNum}" class="${linkClass}" style="${linkStyle}">#${bareNum}</a>`
      }
      if (versionTag) {
        return `<a href="${repoUrl}/releases/tag/${versionTag}" class="${linkClass}" style="${linkStyle}">${versionTag}</a>`
      }
      if (handle) {
        return `<a href="https://github.com/${handle}" class="${linkClass}" style="${linkStyle}">@${handle}</a>`
      }
      return match
    }
  )
}

function compactTitle(title, maxLen = 46) {
  const clean = String(title ?? '').trim()
  const known = {
    'Render brainstorm lenses table with valid GFM pipes': 'Valid GFM pipes in brainstorm table',
    'Resolve Claude Code 2.1.312 plugin manifest key rejection': 'Claude Code 2.1.312 manifest key fix',
    'agy plugin validate --strict fails on root AGENTS.md and missing plugin.json logo': 'agy plugin validate --strict packaging',
    'Unprefixed /egm-* slash commands fail discovery when disable-model-invocation is true': 'Unprefixed /egm-* command discovery',
    'Claude Code child isolation verifier rejects structured SubagentHandback': 'SubagentHandback isolation retest',
    'Bootstrap script test execution and non-Claude harness read-only reviewer enforcement': 'Bootstrap tests & read-only reviewer'
  }
  if (known[clean]) return known[clean]
  return clean.length <= maxLen ? clean : `${clean.slice(0, maxLen - 1).trimEnd()}…`
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
  const latestStars = starCandidates.length ? Math.max(...starCandidates) : 10838
  const sevenDaysAgoRow = starHistoryRows.length >= 8 ? starHistoryRows[starHistoryRows.length - 8] : null
  const sevenDayStarDelta = Number.isFinite(latestStars) && Number.isFinite(sevenDaysAgoRow?.stars)
    ? latestStars - sevenDaysAgoRow.stars
    : null

  const referrers = (queries.referrers?.rows ?? seed?.queries?.referrers?.rows ?? [])
    .slice(0, 5)
    .map(row => `${row.source} (${formatInt(row.views ?? row.count)})`)
    .join(', ')

  const verifiedItems = briefRows.filter(row => row.section === 'improved' && row.stage === 'user-verified')
  const mergedItems = briefRows.filter(row => row.section === 'improved' && row.stage === 'merged-unreleased')
  const attentionItems = briefRows.filter(row => row.section === 'attention')
  const helpItems = briefRows.filter(row => row.section === 'help')
  const commitments = briefRows.filter(row => row.section === 'commitments')
  const verifiedCommitments = commitments.filter(row => row.outcome === 'verified').length

  const dailyRows = Array.isArray(queries.daily_analysis?.rows) ? queries.daily_analysis.rows : []
  const overviewAnalysis = dailyRows.find(row => row.id === 'overview')

  return {
    isoWeek: briefMeta.isoWeek || '2026-W44',
    windowStart: briefMeta.windowStart ? briefMeta.windowStart.slice(0, 10) : '2026-10-26',
    windowEnd: briefMeta.windowEnd ? briefMeta.windowEnd.slice(0, 10) : '2026-11-02',
    latestRelease: briefMeta.latestRelease || ossMetrics.latestRelease || 'v0.1.0',
    headline: briefMeta.headline || 'Release v0.1.0 lags main by 24 in-window merged PRs; first-time users hit slash-command and strict-validator blockers already fixed or tracked on main.',
    implication: briefMeta.implication || 'Cutting a patch release (v0.1.1) and resolving stage-1 plugin packaging (#272) unblocks Antigravity and Claude Code evaluators without adding product telemetry.',
    oneLineInsight: briefMeta.oneLineInsight || (overviewAnalysis?.headline ? `${overviewAnalysis.headline} · ${overviewAnalysis.nextStep}` : null) || 'v0.1.0 lags main by 24 PRs · Ship v0.1.1 and #272 to unblock evaluators.',
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
    mergedItems,
    attentionItems,
    helpItems,
    reviewIssueUrl: briefMeta.reviewIssueUrl || 'https://github.com/n3wth/egm-dashboard/issues/132',
    customImages: Array.isArray(briefMeta.images) ? briefMeta.images : []
  }
}

export async function generateGrowthEmailInsight(env, summary, fetcher = fetch) {
  const infer = env?.INFER ?? geminiRunner(env, fetcher)
  if (!infer?.run) return null
  try {
    const prompt = [
      {
        role: 'system',
        content: 'Write a single concise one-line insight (max 74 characters, no em dashes, no quotes, no markdown) summarizing the release cutline and top blocker action for the EGM weekly maintainer brief. Include the release tag (e.g. v0.1.0) and key issue number (e.g. #272) separated by " · ".'
      },
      {
        role: 'user',
        content: JSON.stringify({
          latestRelease: summary.latestRelease,
          unreleasedMergedPRs: summary.unreleasedMergedPRs,
          headline: summary.headline,
          implication: summary.implication,
          topAttention: summary.attentionItems.slice(0, 2).map(i => ({ title: i.title, issue: i.issue, nextAction: i.nextAction }))
        })
      }
    ]
    const out = await infer.run(GEMINI_MODEL, { messages: prompt, max_tokens: 80, temperature: 0.1, stream: false })
    const line = String(out?.response ?? '').trim().replace(/[—–]/g, '-').replace(/^["']|["']$/g, '')
    if (line.length >= 20 && line.length <= 82 && !/[<>]/.test(line)) return line
  } catch {}
  return null
}

function renderHostedChartOrImage(img) {
  const lightSrc = safeHttpsUrl(img.src)
  if (!lightSrc) return ''
  const darkSrc = safeHttpsUrl(img.darkSrc) || lightSrc
  const href = safeHttpsUrl(img.href) || `${dashboardUrl}/overview`
  const alt = escapeHtml(img.alt || 'EGM growth visual')
  const width = Number.isFinite(img.width) ? img.width : 488
  const height = Number.isFinite(img.height) ? img.height : 106
  const labels = img.showChartHeaders
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td width="50%" class="muted" style="font-size:11px;line-height:14px;color:#76766f">Total stars since launch</td>` +
      `<td width="50%" class="muted" style="font-size:11px;line-height:14px;color:#76766f">New per day, last 14 days</td>` +
      `</tr></table>`
    : ''
  const caption = img.caption ? `<p class="muted" style="margin:6px 0 0;font-size:11px;line-height:16px;color:#76766f">${linkifyRepoText(img.caption)}</p>` : ''
  return (
    `<a href="${escapeHtml(href)}" style="display:block;margin:20px 0 8px;text-decoration:none;border:0">` +
    `<img class="img-light" src="${escapeHtml(lightSrc)}" width="${width}" alt="${alt}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0">` +
    `<img class="img-dark" src="${escapeHtml(darkSrc)}" width="${width}" alt="" style="display:none;max-height:0;overflow:hidden;width:100%;max-width:${width}px;height:auto;border:0">` +
    `</a>` + labels + caption
  )
}

function extractCompactRefs(item, defaultHref) {
  const links = []
  if (Number.isFinite(item.pr)) {
    links.push(`<a href="${repoUrl}/pull/${item.pr}" class="muted-link" style="color:#767676;text-decoration:underline;text-underline-offset:3px">#${item.pr}</a>`)
  }
  if (Number.isFinite(item.issue)) {
    links.push(`<a href="${repoUrl}/issues/${item.issue}" class="muted-link" style="color:#767676;text-decoration:underline;text-underline-offset:3px">#${item.issue}</a>`)
  }
  if (!links.length && typeof defaultHref === 'string') {
    const match = defaultHref.match(/\/(issues|pull)\/(\d+)/)
    if (match) {
      links.push(`<a href="${escapeHtml(defaultHref)}" class="muted-link" style="color:#767676;text-decoration:underline;text-underline-offset:3px">#${match[2]}</a>`)
    }
  }
  const handleMatch = String(item.evidence ?? '').match(/@([A-Za-z0-9-]+)\b/)
  if (handleMatch) {
    links.push(`<a href="https://github.com/${handleMatch[1]}" class="muted-link" style="color:#767676;text-decoration:underline;text-underline-offset:3px">@${handleMatch[1]}</a>`)
  }
  const prRangeMatch = String(item.nextAction ?? '').match(/#(\d+)-#(\d+)/)
  if (prRangeMatch) {
    links.push(`<a href="${repoUrl}/issues/${prRangeMatch[1]}" class="muted-link" style="color:#767676;text-decoration:underline;text-underline-offset:3px">#${prRangeMatch[1]}</a>-<a href="${repoUrl}/issues/${prRangeMatch[2]}" class="muted-link" style="color:#767676;text-decoration:underline;text-underline-offset:3px">#${prRangeMatch[2]}</a>`)
  } else {
    const extraPrMatch = String(item.nextAction ?? '').match(/\bPR\s+#(\d+)\b/)
    if (extraPrMatch && Number(extraPrMatch[1]) !== item.pr) {
      links.push(`<a href="${repoUrl}/pull/${extraPrMatch[1]}" class="muted-link" style="color:#767676;text-decoration:underline;text-underline-offset:3px">#${extraPrMatch[1]}</a>`)
    }
  }
  return links.join(' · ')
}

const C = {
  ink: '#18181a', muted: '#76766f', body: '#5f5f59', line: '#ebebe8', page: '#f4f4f2',
  pos: '#007a32', posBg: '#e5f5eb', hi: '#b3261e', hiBg: '#fdecea', md: '#8a5300', mdBg: '#fdf3e1'
}

function formatCompact(value) {
  if (!Number.isFinite(value)) return 'n/a'
  if (value >= 10000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return formatInt(value)
}

function nextPatchVersion(tag) {
  const match = String(tag ?? '').match(/^v(\d+)\.(\d+)\.(\d+)$/)
  return match ? `v${match[1]}.${match[2]}.${Number(match[3]) + 1}` : 'the next release'
}

function weekRangeLabel(start, end) {
  const s = new Date(`${start}T00:00:00Z`)
  const e = new Date(`${end}T00:00:00Z`)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return ''
  e.setUTCDate(e.getUTCDate() - 1)
  const month = d => d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const left = `${month(s)} ${s.getUTCDate()}`
  const right = month(s) === month(e) ? `${e.getUTCDate()}` : `${month(e)} ${e.getUTCDate()}`
  return `${left} to ${right}, ${e.getUTCFullYear()}`
}

function sectionRule(inner, top = 28) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="line" style="margin:${top}px 0 0;border-top:1px solid ${C.line}"><tr><td style="padding-top:24px">${inner}</td></tr></table>`
}

function statTile(value, label, sub, href, position) {
  const pad = position === 'first' ? 'padding:0 14px 0 0' : position === 'last' ? `padding:0 0 0 14px;border-left:1px solid ${C.line}` : `padding:0 14px;border-left:1px solid ${C.line}`
  return (
    `<td class="stat line${position === 'first' ? ' stat-first' : ''}" width="33%" valign="top" style="${pad}">` +
    `<a href="${escapeHtml(href)}" style="text-decoration:none;display:block">` +
    `<div class="fg" style="font-size:22px;line-height:28px;font-weight:500;color:${C.ink};font-variant-numeric:tabular-nums">${escapeHtml(value)}</div>` +
    `<div class="muted" style="font-size:12px;line-height:17px;color:${C.muted}">${escapeHtml(label)}</div>` +
    `<div class="muted" style="font-size:12px;line-height:17px;color:${C.muted}">${escapeHtml(sub)}</div>` +
    `</a></td>`
  )
}

export function buildGrowthUpdateEmail(snapshot, options = {}) {
  const s = extractGrowthSummary(snapshot)
  const insightLine = options.insightLine || s.oneLineInsight
  const unsubscribeUrl = safeHttpsUrl(options.unsubscribeUrl) || defaultUnsubscribeUrl
  const delta = Number.isFinite(s.sevenDayStarDelta) && s.sevenDayStarDelta > 0 ? s.sevenDayStarDelta : null
  const priorStars = delta ? s.stars - delta : null
  const multiple = delta && priorStars > 0 ? s.stars / priorStars : null
  const multipleText = multiple && multiple >= 1.5 ? `${multiple.toFixed(1).replace(/\.0$/, '')}x` : null
  const nextRelease = nextPatchVersion(s.latestRelease)
  const highItems = s.attentionItems.filter(item => String(item.severity).toLowerCase() === 'high')
  const starDeltaText = delta ? ` (+${formatInt(delta)} over 7 days)` : ''
  const rangeLabel = weekRangeLabel(s.windowStart, s.windowEnd)
  const weekNum = String(s.isoWeek).split('-W')[1]

  const blockerPhrase = highItems.length === 1 ? 'One blocker' : `${['', 'One', 'Two', 'Three', 'Four', 'Five'][highItems.length] || highItems.length} blockers`
  const headline = highItems.length
    ? `${multipleText ? 'Breakout week. ' : ''}${blockerPhrase} before ${nextRelease}.`
    : `${multipleText ? 'Breakout week. ' : ''}Clear path to ${nextRelease}.`
  const leadSentence = multipleText
    ? `Stars grew ${multipleText} to ${formatInt(s.stars)}, and ${formatCompact(s.cloners)} people cloned the repo.`
    : `${formatInt(s.stars)} stars${delta ? `, up ${formatInt(delta)} this week` : ''}, and ${formatCompact(s.cloners)} people cloned the repo.`

  const subject = `EGM Growth & Weekly Brief (${s.isoWeek}): ${formatInt(s.stars)} stars${starDeltaText}`
  const preheader = highItems.length
    ? `${multipleText ? `Stars up ${multipleText} this week. ` : ''}${highItems.length} high-priority ${highItems.length === 1 ? 'fix stands' : 'fixes stand'} between you and ${nextRelease}.`
    : `${formatInt(s.stars)} stars${starDeltaText}. Nothing high-priority blocks ${nextRelease}.`

  const textLines = [
    `EGM Growth & Weekly Building Brief (${s.isoWeek})`,
    '',
    headline,
    leadSentence,
    insightLine,
    '',
    `${formatInt(s.stars)} stars${starDeltaText}`,
    '',
    'Snapshot (14d):',
    `- Repo traffic (14d): ${formatInt(s.visitors)} visitors · ${formatInt(s.views)} views (${dashboardUrl}/acquisition)`,
    `- Git clones (14d): ${formatInt(s.cloners)} cloners · ${formatInt(s.clones)} clones (${dashboardUrl}/adoption)`,
    `- egm.dev referrals: ${formatInt(s.websiteReferralVisitors)} visitors · ${formatInt(s.websiteReferralViews)} views (${dashboardUrl}/website)`,
    `- Release cutline: ${s.unreleasedMergedPRs} PRs since ${s.latestRelease} (${repoUrl}/compare/${s.latestRelease}...main) · ${s.verifiedCommitments}/${s.totalCommitments} verified (${s.reviewIssueUrl})`,
    '',
    `To do before ${nextRelease}:`,
    ...s.attentionItems.map((item, i) => `${i + 1}. [${item.severity}] ${item.title}: ${item.nextAction} (${item.url || repoUrl})`),
    '',
    'Confirmed fixed by users:',
    ...s.verifiedItems.map(item => `- ${item.title}: ${item.evidence} (${item.url || repoUrl})`),
    '',
    `Open the dashboard: ${dashboardUrl}`,
    `Weekly Building Brief: ${dashboardUrl}/development#weekly-building-brief`,
    `Future briefs arrive Mondays · Unsubscribe: ${unsubscribeUrl}`
  ]

  const allImages = [
    ...(options.includeDefaultChart === false ? [] : [{
      src: growthChartLightUrl,
      darkSrc: growthChartDarkUrl,
      href: `${dashboardUrl}/overview`,
      alt: priorStars ? `Chart: stars rose from about ${formatInt(priorStars)} to ${formatInt(s.stars)} over the past week.` : `Cumulative and daily new stars for ${s.isoWeek}`,
      width: 488,
      height: 106,
      showChartHeaders: true
    }]),
    ...s.customImages,
    ...(Array.isArray(options.images) ? options.images : [])
  ]
  const imagesHtml = allImages.map(renderHostedChartOrImage).join('')

  const todoHtml = s.attentionItems.map((item, i) => {
    const itemHref = safeHttpsUrl(item.url) || `${dashboardUrl}/development#weekly-brief-attention`
    const isHigh = String(item.severity).toLowerCase() === 'high'
    const refs = extractCompactRefs(item, itemHref)
    const last = i === s.attentionItems.length - 1
    const badge = isHigh
      ? `<span class="hi" style="display:inline-block;padding:2px 7px;border-radius:4px;background:${C.hiBg};color:${C.hi};font-weight:500">High</span>`
      : `<span class="md" style="display:inline-block;padding:2px 7px;border-radius:4px;background:${C.mdBg};color:${C.md};font-weight:500">Medium</span>`
    const numStyle = isHigh ? `background:${C.ink};color:#ffffff` : `background:${C.line};color:${C.ink}`
    return (
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="line" style="${last ? '' : `border-bottom:1px solid ${C.line}`}"><tr>` +
      `<td width="32" valign="top" style="padding:16px 0"><span class="${isHigh ? 'num' : 'num-soft'}" style="display:inline-block;width:22px;height:22px;border-radius:11px;${numStyle};font-size:12px;line-height:22px;font-weight:500;text-align:center">${i + 1}</span></td>` +
      `<td valign="top" style="padding:16px 0">` +
      `<div style="font-size:15px;line-height:22px"><a href="${escapeHtml(itemHref)}" class="fg" title="${escapeHtml(item.title)}" style="color:${C.ink};text-decoration:none;font-weight:500">${escapeHtml(compactTitle(item.title))}</a></div>` +
      (item.nextAction ? `<div class="muted" style="font-size:13px;line-height:20px;color:${C.body}">${linkifyRepoText(item.nextAction, 'muted-link', `color:${C.body};text-underline-offset:3px`)}</div>` : '') +
      `<div style="margin-top:6px;font-size:12px;line-height:16px">${badge}<span class="muted" style="color:${C.muted}">&nbsp; ${refs}</span></div>` +
      `</td></tr></table>`
    )
  }).join('')

  const verifiedHtml = s.verifiedItems.map(item => {
    const itemHref = safeHttpsUrl(item.url) || `${dashboardUrl}/development#weekly-brief-improved`
    const refs = extractCompactRefs(item, itemHref)
    return (
      `<tr><td width="24" valign="top" class="pos" style="padding:5px 0;font-size:14px;line-height:21px;color:${C.pos}">&#10003;</td>` +
      `<td style="padding:5px 0;font-size:14px;line-height:21px"><a href="${escapeHtml(itemHref)}" class="fg" title="${escapeHtml(item.title)}" style="color:${C.ink};text-decoration:none">${escapeHtml(compactTitle(item.title))}</a>` +
      `<span class="muted" style="color:${C.muted};font-size:12px">&nbsp; ${refs}</span></td></tr>`
    )
  }).join('')

  const progressPct = s.totalCommitments ? Math.round((s.verifiedCommitments / s.totalCommitments) * 100) : 0
  const progressFill = progressPct > 0
    ? `<table role="presentation" width="${progressPct}%" cellpadding="0" cellspacing="0" border="0"><tr><td class="fill" height="6" style="background:${C.ink};border-radius:3px;font-size:0;line-height:0">&nbsp;</td></tr></table>`
    : '&nbsp;'

  const darkRules = [
    `body,.bg{background:#0e0e0e !important}`,
    `.card{background:#171717 !important;border-color:#262626 !important}`,
    `.fg{color:#f2f2f2 !important}`,
    `.muted,.muted-link{color:#9a9a9a !important}`,
    `.line,.stat{border-color:#262626 !important}`,
    `.track,.num-soft{background:#2a2a2a !important}`,
    `.num-soft{color:#f2f2f2 !important}`,
    `.fill,.num{background:#f2f2f2 !important}`,
    `.num{color:#171717 !important}`,
    `.pos{color:#4ad083 !important}`,
    `.pill{background:#123020 !important;color:#4ad083 !important}`,
    `.hi{background:#3a1512 !important;color:#ff8a80 !important}`,
    `.md{background:#33260c !important;color:#f0b44c !important}`,
    `.btn{background:#f2f2f2 !important}.btn a{color:#171717 !important}`,
    `.img-light{display:none !important;max-height:0 !important;overflow:hidden !important}`,
    `.img-dark{display:block !important;max-height:none !important;overflow:visible !important}`
  ].join('')

  const styles = [
    `@font-face{font-family:'Suisse Intl';font-style:normal;font-weight:400;src:url('${dashboardUrl}/fonts/SuisseIntl-Book.woff2') format('woff2')}`,
    `@font-face{font-family:'Suisse Intl';font-style:normal;font-weight:500;src:url('${dashboardUrl}/fonts/SuisseIntl-Medium.woff2') format('woff2')}`,
    `:root{color-scheme:light dark;supported-color-schemes:light dark}`,
    `body{margin:0 !important;padding:0 !important;width:100% !important;background:${C.page};-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}`,
    `a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important}`,
    `.img-dark{display:none !important;max-height:0 !important;overflow:hidden !important}`,
    `@media (max-width:540px){.pad{padding:24px 20px !important}.stat{padding-left:10px !important;padding-right:10px !important}.stat-first{padding-left:0 !important}.hero{font-size:52px !important;line-height:54px !important}}`,
    `@media (prefers-color-scheme:dark){${darkRules}}`,
    `[data-ogsc] .fg{color:#f2f2f2 !important}[data-ogsc] .muted{color:#9a9a9a !important}`,
    `[data-ogsb] .card{background:#171717 !important}[data-ogsb] .bg{background:#0e0e0e !important}`
  ].join('')

  const html =
    `<!DOCTYPE html><html lang="en" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="x-apple-disable-message-reformatting">` +
    `<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">` +
    `<meta name="color-scheme" content="light dark">` +
    `<meta name="supported-color-schemes" content="light dark">` +
    `<title>${escapeHtml(subject)}</title>` +
    `<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>td,a,div,span,p{font-family:Arial,sans-serif !important}</style><![endif]-->` +
    `<style>${styles}</style>` +
    `</head>` +
    `<body class="bg" style="margin:0;padding:0;background:${C.page};font-family:${font}">` +
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}${'&#8199;&#847;'.repeat(40)}</div>` +
    `<div role="article" aria-roledescription="email" aria-label="EGM weekly brief, ${escapeHtml(s.isoWeek)}" lang="en">` +
    `<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}">` +
    `<tr><td align="center" style="padding:32px 12px 8px">` +
    `<!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${C.line};border-radius:14px;border-collapse:separate">` +
    `<tr><td class="pad" style="padding:36px">` +

    // Header: logo on a fixed white tile so it survives forced dark mode
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td valign="middle"><a href="${dashboardUrl}" style="text-decoration:none;display:inline-block"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${C.line};border-radius:8px;padding:7px 8px"><img src="${logoBlackUrl}" width="36" height="21" alt="EGM" style="display:block;width:36px;height:21px;border:0"></td></tr></table></a></td>` +
    `<td align="right" valign="middle" class="muted" style="font-size:12px;line-height:16px;color:${C.muted}"><a href="${dashboardUrl}/development#weekly-building-brief" class="muted-link" style="color:${C.muted};text-decoration:none">Week ${escapeHtml(weekNum || s.isoWeek)}${rangeLabel ? ` · ${escapeHtml(rangeLabel)}` : ''}</a></td>` +
    `</tr></table>` +

    // Summary
    `<h1 class="fg" style="margin:32px 0 10px;font-size:24px;line-height:31px;font-weight:500;letter-spacing:-0.015em;color:${C.ink}">${escapeHtml(headline)}</h1>` +
    `<p class="muted" style="margin:0 0 6px;font-size:15px;line-height:23px;color:${C.body}">${escapeHtml(leadSentence)}</p>` +
    (insightLine ? `<p class="muted" style="margin:0;font-size:13px;line-height:20px;color:${C.muted}">${linkifyRepoText(insightLine, 'muted-link', `color:${C.muted};text-underline-offset:3px`)}</p>` : '') +

    // Hero metric + chart
    sectionRule(
      `<div class="muted" style="font-size:12px;line-height:16px;font-weight:500;color:${C.muted}">GitHub stars</div>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px"><tr>` +
      `<td class="fg hero" style="font-size:60px;line-height:62px;font-weight:500;letter-spacing:-0.035em;color:${C.ink};font-variant-numeric:tabular-nums">${escapeHtml(formatInt(s.stars))}</td>` +
      (delta ? `<td valign="bottom" style="padding:0 0 10px 12px"><span class="pill" style="display:inline-block;padding:4px 9px;border-radius:999px;background:${C.posBg};color:${C.pos};font-size:13px;line-height:17px;font-weight:500;white-space:nowrap">&uarr; ${escapeHtml(formatInt(delta))} this week</span></td>` : '') +
      `</tr></table>` +
      imagesHtml
    ) +

    // Stats
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0"><tr>` +
    statTile(formatCompact(s.visitors), 'repo visitors', `${formatCompact(s.views)} views`, `${dashboardUrl}/acquisition`, 'first') +
    statTile(formatCompact(s.cloners), 'unique cloners', `${formatCompact(s.clones)} clones`, `${dashboardUrl}/adoption`, 'middle') +
    statTile(formatCompact(s.websiteReferralVisitors), 'from egm.dev', `${formatInt(s.websiteReferralViews)} views`, `${dashboardUrl}/website`, 'last') +
    `</tr></table>` +
    `<div class="muted" style="margin:12px 0 0;font-size:11px;line-height:14px;color:${C.muted}">Traffic covers the last 14 days. GitHub reports no shorter window.</div>` +

    // To-do list
    sectionRule(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td class="fg" style="font-size:17px;line-height:22px;font-weight:500;color:${C.ink}">Your to-do list for ${escapeHtml(nextRelease)}</td>` +
      `<td align="right" class="muted" style="font-size:12px;line-height:22px;color:${C.muted}"><a href="${escapeHtml(s.reviewIssueUrl)}" class="muted-link" style="color:${C.muted};text-underline-offset:3px">${escapeHtml(String(s.verifiedCommitments))} of ${escapeHtml(String(s.totalCommitments))} verified</a></td>` +
      `</tr></table>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 4px"><tr><td class="track" height="6" style="background:${C.line};border-radius:3px;font-size:0;line-height:0">${progressFill}</td></tr></table>` +
      `<div class="muted" style="font-size:12px;line-height:17px;color:${C.muted};margin-bottom:8px"><a href="${repoUrl}/compare/${encodeURIComponent(s.latestRelease)}...main" class="muted-link" style="color:${C.muted};text-underline-offset:3px">${escapeHtml(String(s.unreleasedMergedPRs))} PRs merged since ${escapeHtml(s.latestRelease)}</a></div>` +
      (todoHtml || `<p class="muted" style="margin:12px 0 0;font-size:14px;line-height:21px;color:${C.body}">Nothing needs you this week.</p>`),
      32
    ) +

    // Verified
    (verifiedHtml ? sectionRule(
      `<div class="fg" style="font-size:17px;line-height:22px;font-weight:500;color:${C.ink};margin-bottom:10px">Confirmed fixed by users</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${verifiedHtml}</table>`,
      12
    ) : '') +

    // CTA (bulletproof, with VML for Outlook desktop)
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0"><tr><td>` +
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${dashboardUrl}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="18%" stroke="f" fillcolor="${C.ink}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">Open the dashboard</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!--><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="btn" style="border-radius:8px;background:${C.ink}"><a href="${dashboardUrl}" style="display:inline-block;padding:13px 22px;border-radius:8px;color:#ffffff;font-size:14px;font-weight:500;line-height:18px;text-decoration:none">Open the dashboard &rarr;</a></td></tr></table><!--<![endif]-->` +
    `</td></tr></table>` +

    `</td></tr></table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +

    // Footer below the card
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px"><tr>` +
    `<td class="muted" style="padding:18px 6px 32px;font-size:12px;line-height:18px;color:${C.muted}">EGM Growth Dashboard · Future briefs arrive Mondays<br>` +
    `<a href="${dashboardUrl}/development#weekly-building-brief" class="muted-link" style="color:${C.muted};text-underline-offset:3px">Full weekly brief</a> · ` +
    `<a href="${escapeHtml(unsubscribeUrl)}" class="muted-link" style="color:${C.muted};text-underline-offset:3px">Unsubscribe</a></td>` +
    `</tr></table>` +

    `</td></tr></table>` +
    `</div>` +
    `</body></html>`

  return { subject, text: textLines.join('\n'), html, isoWeek: s.isoWeek, unsubscribeUrl }
}

export function growthUpdateEmailPreview(snapshot, scheme = 'light', options = {}) {
  const { html } = buildGrowthUpdateEmail(snapshot, options)
  if (scheme !== 'dark') return html
  const forced = html.match(/@media \(prefers-color-scheme:dark\)\{(.*?)\}\[data-ogsc\]/)?.[1] ?? ''
  return html.replace('</head>', `<style>${forced}</style></head>`)
}

async function ensureGrowthEmailTables(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS growth_update_emails (id TEXT PRIMARY KEY, recipient TEXT NOT NULL, state TEXT NOT NULL, provider_id TEXT, claimed_at TEXT NOT NULL, sent_at TEXT)'
  ).run()
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS growth_email_unsubscribes (email TEXT PRIMARY KEY, unsubscribed_at TEXT NOT NULL)'
  ).run()
}

export async function unsubscribeGrowthEmail(env, token, secrets) {
  const signingSecrets = secrets || [env?.SESSION_SECRET, env?.SESSION_SECRET_PREVIOUS, env?.RESEND_API_KEY].filter(Boolean)
  const email = await verifyUnsubscribeToken(token, signingSecrets)
  if (!email) return { status: 'invalid_token' }
  await ensureGrowthEmailTables(env)
  const nowIso = new Date().toISOString()
  await env.DB.prepare(
    'INSERT INTO growth_email_unsubscribes(email, unsubscribed_at) VALUES(?, ?) ON CONFLICT(email) DO UPDATE SET unsubscribed_at=excluded.unsubscribed_at'
  ).bind(email, nowIso).run()
  return { status: 'unsubscribed', email, unsubscribedAt: nowIso }
}

async function loadApprovedRecipients(env, explicitRecipient) {
  const approvedSet = new Set([defaultGrowthRecipient])
  try {
    const res = await env.DB.prepare("SELECT email FROM users WHERE status='approved' AND verified=1 ORDER BY created_at ASC").all()
    const rows = Array.isArray(res?.results) ? res.results : Array.isArray(res) ? res : []
    for (const row of rows) {
      if (typeof row?.email === 'string' && row.email.includes('@')) {
        approvedSet.add(row.email.trim().toLowerCase())
      }
    }
  } catch {}

  const unsubscribedSet = new Set()
  try {
    const unsubRes = await env.DB.prepare('SELECT email FROM growth_email_unsubscribes').all()
    const rows = Array.isArray(unsubRes?.results) ? unsubRes.results : Array.isArray(unsubRes) ? unsubRes : []
    for (const row of rows) {
      if (typeof row?.email === 'string') {
        unsubscribedSet.add(row.email.trim().toLowerCase())
      }
    }
  } catch {}

  if (explicitRecipient !== undefined && explicitRecipient !== null) {
    const clean = String(explicitRecipient).trim().toLowerCase()
    if (!approvedSet.has(clean)) return { allowed: false, recipients: [] }
    if (unsubscribedSet.has(clean)) return { allowed: true, unsubscribed: true, recipients: [] }
    return { allowed: true, recipients: [clean] }
  }

  const recipients = [...approvedSet].filter(email => !unsubscribedSet.has(email))
  return { allowed: true, recipients }
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

async function sendSingleRecipientEmail(env, { recipientEmail, snapshot, summary, insightLine, idempotencySuffix, force, images, signingSecrets }, fetcher) {
  const unsubscribeUrl = await buildUnsubscribeUrl(recipientEmail, signingSecrets)
  const email = buildGrowthUpdateEmail(snapshot, { images, insightLine, unsubscribeUrl })
  const recordId = `${email.isoWeek}:${recipientEmail}:${idempotencySuffix}`
  const nowIso = new Date().toISOString()

  if (!force) {
    const existing = await env.DB.prepare('SELECT state, provider_id, sent_at FROM growth_update_emails WHERE id=?').bind(recordId).first()
    if (existing?.state === 'sent') {
      return { status: 'already_sent', recipient: recipientEmail, id: recordId, providerId: existing.provider_id, sentAt: existing.sent_at }
    }
    const claim = await env.DB.prepare(
      "INSERT INTO growth_update_emails(id, recipient, state, claimed_at) VALUES(?, ?, 'claimed', ?) ON CONFLICT(id) DO UPDATE SET state='claimed', claimed_at=excluded.claimed_at WHERE growth_update_emails.state='failed'"
    ).bind(recordId, recipientEmail, nowIso).run()
    if (claim.meta?.changes !== 1) {
      return { status: 'in_progress_or_sent', recipient: recipientEmail, id: recordId }
    }
  } else {
    await env.DB.prepare(
      "INSERT INTO growth_update_emails(id, recipient, state, claimed_at) VALUES(?, ?, 'claimed', ?) ON CONFLICT(id) DO UPDATE SET state='claimed', claimed_at=excluded.claimed_at"
    ).bind(recordId, recipientEmail, nowIso).run()
  }

  const idempotencyKey = `egm-growth-update/${recordId}${force ? `/${Date.now()}` : ''}`.replace(/[^A-Za-z0-9_/:.-]/g, '-')
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
        to: [recipientEmail],
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000)
    })
    if (!response.ok) {
      await response.text().catch(() => {})
      await env.DB.prepare("UPDATE growth_update_emails SET state='failed' WHERE id=?").bind(recordId).run()
      return { status: 'failed', recipient: recipientEmail, httpStatus: response.status, id: recordId }
    }
    let providerId = null
    try {
      const payload = await response.json()
      if (typeof payload?.id === 'string') providerId = payload.id
    } catch {}
    const sentAt = new Date().toISOString()
    await env.DB.prepare("UPDATE growth_update_emails SET state='sent', provider_id=?, sent_at=? WHERE id=?").bind(providerId, sentAt, recordId).run()
    return { status: 'sent', recipient: recipientEmail, id: recordId, providerId, sentAt, subject: email.subject }
  } catch {
    try {
      await env.DB.prepare("UPDATE growth_update_emails SET state='failed' WHERE id=?").bind(recordId).run()
    } catch {}
    return { status: 'failed', recipient: recipientEmail, id: recordId }
  }
}

export async function sendGrowthUpdateEmail(
  env,
  { recipient = null, idempotencySuffix = 'w44-broadcast', force = false, onlyMondays = false, nowDate = new Date(), images = [] } = {},
  fetcher = fetch
) {
  if (!env?.RESEND_API_KEY) return { status: 'missing_api_key' }
  if (onlyMondays) {
    const d = nowDate instanceof Date ? nowDate : new Date(nowDate)
    if (d.getUTCDay() !== 1 || d.getUTCHours() < 15) {
      return { status: 'skipped_not_monday' }
    }
  }

  await ensureGrowthEmailTables(env)
  const { allowed, unsubscribed, recipients } = await loadApprovedRecipients(env, recipient)
  if (!allowed) return { status: 'recipient_not_allowed' }
  if (unsubscribed) return { status: 'unsubscribed' }
  if (!recipients.length) return { status: 'no_recipients', sentCount: 0, recipients: [] }

  const snapshot = await loadCurrentSnapshot(env)
  const summary = extractGrowthSummary(snapshot)
  const llmInsight = await generateGrowthEmailInsight(env, summary, fetcher)
  const insightLine = llmInsight || summary.oneLineInsight
  const signingSecrets = [env?.SESSION_SECRET, env?.SESSION_SECRET_PREVIOUS, env?.RESEND_API_KEY].filter(Boolean)

  const results = []
  for (const recipientEmail of recipients) {
    const res = await sendSingleRecipientEmail(
      env,
      { recipientEmail, snapshot, summary, insightLine, idempotencySuffix, force, images, signingSecrets },
      fetcher
    )
    results.push(res)
  }

  const sentCount = results.filter(r => r.status === 'sent').length
  const alreadySentCount = results.filter(r => r.status === 'already_sent' || r.status === 'in_progress_or_sent').length
  const failedCount = results.filter(r => r.status === 'failed').length
  const first = results[0] ?? {}
  const overallStatus = sentCount > 0
    ? 'sent'
    : alreadySentCount === results.length
    ? 'already_sent'
    : failedCount > 0
    ? 'failed'
    : (first.status || 'no_recipients')

  return {
    status: overallStatus,
    sentCount,
    alreadySentCount,
    failedCount,
    id: first.id,
    providerId: first.providerId,
    sentAt: first.sentAt,
    subject: first.subject,
    recipients: results
  }
}
