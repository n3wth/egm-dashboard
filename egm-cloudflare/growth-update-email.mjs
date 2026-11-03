import seed from '../egm-performance/src/data.json' with { type: 'json' }
import { decisionSender, dashboardUrl, logoBlackUrl, logoWhiteUrl } from './decision-email.mjs'
import { GEMINI_MODEL, geminiRunner } from './gemini.mjs'

export const defaultGrowthRecipient = 'newth@google.com'
export const repoUrl = 'https://github.com/google/elephant-goldfish-model'
export const websiteUrl = 'https://egm.dev'
export const growthChartLightUrl = `${dashboardUrl}/email/growth-chart-light.png?v=4`
export const growthChartDarkUrl = `${dashboardUrl}/email/growth-chart-dark.png?v=4`

const font = `'Suisse Intl',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`

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
  const width = Number.isFinite(img.width) ? img.width : 444
  const height = Number.isFinite(img.height) ? img.height : 120
  const caption = img.caption ? `<p class="muted" style="margin:6px 0 0;font-size:11px;line-height:16px;color:#767676;text-align:left">${linkifyRepoText(img.caption)}</p>` : ''

  return (
    `<div class="divider-band" style="padding:14px 0;border-top:1px solid #ededed;border-bottom:1px solid #ededed;margin:14px 0 16px">` +
    `<a href="${escapeHtml(href)}" style="display:block;text-decoration:none;border:0">` +
    `<img class="img-light" src="${escapeHtml(lightSrc)}" width="${width}" height="${height}" alt="${alt}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0">` +
    `<img class="img-dark" src="${escapeHtml(darkSrc)}" width="${width}" height="${height}" alt="${alt}" style="display:none;max-height:0;overflow:hidden;width:100%;max-width:${width}px;height:auto;border:0">` +
    `</a>` +
    caption +
    `</div>`
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

export function buildGrowthUpdateEmail(snapshot, options = {}) {
  const s = extractGrowthSummary(snapshot)
  const insightLine = options.insightLine || s.oneLineInsight
  const starDeltaText = Number.isFinite(s.sevenDayStarDelta) && s.sevenDayStarDelta > 0
    ? ` (+${formatInt(s.sevenDayStarDelta)} over 7 days)`
    : ''
  const starBadgeHtml = Number.isFinite(s.sevenDayStarDelta) && s.sevenDayStarDelta > 0
    ? ` <span class="positive" style="font-size:15px;font-weight:500;color:#00a240;margin-left:4px">+${escapeHtml(formatInt(s.sevenDayStarDelta))} (7d)</span>`
    : ''
  const subject = `EGM Growth & Weekly Brief (${s.isoWeek}): ${formatInt(s.stars)} stars${starDeltaText}`
  const preheader = `${formatInt(s.stars)} stars${starDeltaText}, ${formatInt(s.visitors)} visitors (14d), ${formatInt(s.cloners)} cloners, and ${s.isoWeek} maintainer brief.`

  const textLines = [
    `EGM Growth & Weekly Building Brief (${s.isoWeek})`,
    '',
    `${formatInt(s.stars)} stars${starDeltaText}`,
    insightLine,
    '',
    'Snapshot (14d):',
    `- Repo traffic (14d): ${formatInt(s.visitors)} visitors · ${formatInt(s.views)} views (${dashboardUrl}/acquisition)`,
    `- Git clones (14d): ${formatInt(s.cloners)} cloners · ${formatInt(s.clones)} clones (${dashboardUrl}/adoption)`,
    `- egm.dev referrals: ${formatInt(s.websiteReferralVisitors)} visitors · ${formatInt(s.websiteReferralViews)} views (${dashboardUrl}/website)`,
    `- Release cutline: ${s.unreleasedMergedPRs} PRs since ${s.latestRelease} (${repoUrl}/compare/${s.latestRelease}...main) · ${s.verifiedCommitments}/${s.totalCommitments} verified (${s.reviewIssueUrl})`,
    '',
    'User-verified improvements:',
    ...s.verifiedItems.map(item => `- ${item.title}: ${item.evidence} (${item.url || repoUrl})`),
    '',
    'Needs attention:',
    ...s.attentionItems.map(item => `- [${item.severity}] ${item.title}: ${item.nextAction} (${item.url || repoUrl})`),
    '',
    `Open the dashboard: ${dashboardUrl}`,
    `Weekly Building Brief: ${dashboardUrl}/development#weekly-building-brief`
  ]

  const allImages = [
    ...(options.includeDefaultChart === false ? [] : [{
      src: growthChartLightUrl,
      darkSrc: growthChartDarkUrl,
      href: `${dashboardUrl}/overview`,
      alt: `Cumulative stars (51d) and daily new stars (14d) for ${s.isoWeek}`,
      width: 444,
      height: 120
    }]),
    ...s.customImages,
    ...(Array.isArray(options.images) ? options.images : [])
  ]
  const imagesHtml = allImages.map(renderHostedChartOrImage).join('')

  const verifiedRowsHtml = s.verifiedItems.map(item => {
    const itemHref = safeHttpsUrl(item.url) || `${dashboardUrl}/development#weekly-brief-improved`
    const rightMeta = extractCompactRefs(item, itemHref)
    return (
      `<tr>` +
      `<td style="padding:4px 0;font-size:13px;line-height:19px;white-space:nowrap">` +
      `<a href="${escapeHtml(itemHref)}" class="primary-link" title="${escapeHtml(item.title)}" style="color:#1a1c1f;text-decoration:underline;text-underline-offset:3px;text-decoration-color:#ededed">${escapeHtml(compactTitle(item.title))}</a>` +
      `</td>` +
      `<td align="right" class="muted" style="padding:4px 0 4px 12px;font-size:12px;line-height:18px;color:#767676;white-space:nowrap">${rightMeta}</td>` +
      `</tr>`
    )
  }).join('')

  const attentionRowsHtml = s.attentionItems.map(item => {
    const itemHref = safeHttpsUrl(item.url) || `${dashboardUrl}/development#weekly-brief-attention`
    const isHigh = String(item.severity).toLowerCase() === 'high'
    const sev = isHigh ? 'High' : 'Med'
    const refs = extractCompactRefs(item, itemHref)
    const rightMeta = [sev, refs].filter(Boolean).join(' · ')
    return (
      `<tr>` +
      `<td style="padding:4px 0;font-size:13px;line-height:19px;white-space:nowrap">` +
      `<a href="${escapeHtml(itemHref)}" class="primary-link" title="${escapeHtml(item.title)}" style="color:#1a1c1f;text-decoration:underline;text-underline-offset:3px;text-decoration-color:#ededed">${escapeHtml(compactTitle(item.title))}</a>` +
      `</td>` +
      `<td align="right" class="muted" style="padding:4px 0 4px 12px;font-size:12px;line-height:18px;color:#767676;white-space:nowrap">${rightMeta}</td>` +
      `</tr>`
    )
  }).join('')

  const styles = [
    `@font-face{font-family:'Suisse Intl';font-style:normal;font-weight:400;src:url('${dashboardUrl}/fonts/SuisseIntl-Book.woff2') format('woff2')}`,
    `@font-face{font-family:'Suisse Intl';font-style:normal;font-weight:500;src:url('${dashboardUrl}/fonts/SuisseIntl-Medium.woff2') format('woff2')}`,
    `@font-face{font-family:'Suisse Intl';font-style:normal;font-weight:600;src:url('${dashboardUrl}/fonts/SuisseIntl-Semibold.woff2') format('woff2')}`,
    `:root{color-scheme:light dark;supported-color-schemes:light dark}`,
    `body{margin:0;padding:0;background:transparent;background-color:transparent;-webkit-font-smoothing:antialiased}`,
    `.logo-dark,.img-dark{display:none !important;max-height:0 !important;overflow:hidden !important}`,
    `@media (prefers-color-scheme:dark){`,
    `.card{border-color:#303030 !important}`,
    `.heading,.primary-link,.metric-val{color:#f5f5f5 !important}`,
    `.primary-link{text-decoration-color:#303030 !important}`,
    `.positive{color:#40c977 !important}`,
    `.muted,.muted-link,.section-label{color:#afafaf !important}`,
    `.divider-band{border-top-color:#303030 !important;border-bottom-color:#303030 !important}`,
    `.divider-top{border-top-color:#303030 !important}`,
    `.logo-light,.img-light{display:none !important;max-height:0 !important;overflow:hidden !important}`,
    `.logo-dark,.img-dark{display:block !important;max-height:none !important;overflow:visible !important}`,
    `.button-primary a{background-color:#f5f5f5 !important;color:#181818 !important}`,
    `}`
  ].join('')

  const html =
    `<!DOCTYPE html><html lang="en" dir="ltr"><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light dark">` +
    `<meta name="supported-color-schemes" content="light dark">` +
    `<title>${escapeHtml(subject)}</title>` +
    `<style>${styles}</style>` +
    `</head>` +
    `<body style="margin:0;padding:0;background:transparent;background-color:transparent;font-family:${font}">` +
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:transparent;background-color:transparent">` +
    `<tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:500px;background:transparent;background-color:transparent;border:1px solid #ededed;border-radius:12px;border-collapse:separate">` +
    `<tr><td style="padding:28px">` +

    // Minimal Header: EGM mark left, week right
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">` +
    `<tr>` +
    `<td align="left" valign="middle">` +
    `<a href="${dashboardUrl}" style="display:inline-block;text-decoration:none;border:0">` +
    `<img class="logo-light" src="${logoBlackUrl}" width="44" height="26" alt="EGM" style="display:block;width:44px;height:26px;border:0">` +
    `<img class="logo-dark" src="${logoWhiteUrl}" width="44" height="26" alt="EGM" style="display:none;max-height:0;overflow:hidden;width:44px;height:26px;border:0">` +
    `</a>` +
    `</td>` +
    `<td align="right" valign="middle">` +
    `<a href="${dashboardUrl}/development#weekly-building-brief" class="muted-link" style="font-size:12px;line-height:16px;color:#767676;text-decoration:none">${escapeHtml(s.isoWeek)}</a>` +
    `</td>` +
    `</tr>` +
    `</table>` +

    // Hero Metric + 1-line LLM/Maintainer Insight
    `<div class="heading" style="margin:0 0 6px;font-size:28px;line-height:34px;font-weight:500;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;color:#1a1c1f">` +
    `${escapeHtml(formatInt(s.stars))} stars${starBadgeHtml}` +
    `</div>` +
    `<p class="muted" style="margin:0 0 14px;font-size:13px;line-height:20px;color:#767676;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${linkifyRepoText(insightLine)}</p>` +

    // Hosted Transparent Chart (Light/Dark swapped via media query)
    imagesHtml +

    // Flat 4-row Metric Strip (1 line per row)
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 18px;white-space:nowrap">` +
    `<tr>` +
    `<td class="muted" style="padding:5px 0;font-size:13px;line-height:19px;color:#767676"><a href="${dashboardUrl}/acquisition" class="muted-link" style="color:#767676;text-decoration:none">Repo traffic (14d)</a></td>` +
    `<td align="right" class="metric-val" style="padding:5px 0;font-size:13px;line-height:19px;color:#1a1c1f;font-variant-numeric:tabular-nums"><a href="${dashboardUrl}/acquisition" class="primary-link" style="color:#1a1c1f;text-decoration:none">${escapeHtml(formatInt(s.visitors))} visitors · ${escapeHtml(formatInt(s.views))} views</a></td>` +
    `</tr>` +
    `<tr>` +
    `<td class="muted" style="padding:5px 0;font-size:13px;line-height:19px;color:#767676"><a href="${dashboardUrl}/adoption" class="muted-link" style="color:#767676;text-decoration:none">Git clones (14d)</a></td>` +
    `<td align="right" class="metric-val" style="padding:5px 0;font-size:13px;line-height:19px;color:#1a1c1f;font-variant-numeric:tabular-nums"><a href="${dashboardUrl}/adoption" class="primary-link" style="color:#1a1c1f;text-decoration:none">${escapeHtml(formatInt(s.cloners))} cloners · ${escapeHtml(formatInt(s.clones))} clones</a></td>` +
    `</tr>` +
    `<tr>` +
    `<td class="muted" style="padding:5px 0;font-size:13px;line-height:19px;color:#767676"><a href="${websiteUrl}" class="muted-link" style="color:#767676;text-decoration:underline;text-underline-offset:3px">egm.dev</a> referrals</td>` +
    `<td align="right" class="metric-val" style="padding:5px 0;font-size:13px;line-height:19px;color:#1a1c1f;font-variant-numeric:tabular-nums"><a href="${dashboardUrl}/website" class="primary-link" style="color:#1a1c1f;text-decoration:none">${escapeHtml(formatInt(s.websiteReferralVisitors))} visitors · ${escapeHtml(formatInt(s.websiteReferralViews))} views</a></td>` +
    `</tr>` +
    `<tr>` +
    `<td class="muted" style="padding:5px 0;font-size:13px;line-height:19px;color:#767676">Release cutline</td>` +
    `<td align="right" class="metric-val" style="padding:5px 0;font-size:13px;line-height:19px;color:#1a1c1f;font-variant-numeric:tabular-nums"><a href="${repoUrl}/compare/${encodeURIComponent(s.latestRelease)}...main" class="primary-link" style="color:#1a1c1f;text-decoration:underline;text-underline-offset:3px;text-decoration-color:#ededed">${escapeHtml(String(s.unreleasedMergedPRs))} PRs since ${escapeHtml(s.latestRelease)}</a> · <a href="${escapeHtml(s.reviewIssueUrl)}" class="primary-link" style="color:#1a1c1f;text-decoration:underline;text-underline-offset:3px;text-decoration-color:#ededed">${escapeHtml(String(s.verifiedCommitments))}/${escapeHtml(String(s.totalCommitments))} verified</a></td>` +
    `</tr>` +
    `</table>` +

    // User-verified improvements (1 line each)
    (verifiedRowsHtml ? (
      `<div class="divider-top" style="border-top:1px solid #ededed;padding-top:14px;margin:0 0 16px">` +
      `<div class="section-label" style="font-size:12px;line-height:16px;font-weight:500;color:#767676;margin:0 0 8px">User-verified improvements</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${verifiedRowsHtml}</table>` +
      `</div>`
    ) : '') +

    // Needs attention (1 line each)
    (attentionRowsHtml ? (
      `<div class="divider-top" style="border-top:1px solid #ededed;padding-top:14px;margin:0 0 20px">` +
      `<div class="section-label" style="font-size:12px;line-height:16px;font-weight:500;color:#767676;margin:0 0 8px">Needs attention</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${attentionRowsHtml}</table>` +
      `</div>`
    ) : '') +

    // Single CTA Button
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">` +
    `<tr>` +
    `<td class="button-primary" align="left" style="border-radius:8px">` +
    `<a href="${dashboardUrl}" style="display:inline-block;padding:9px 16px;border-radius:8px;background-color:#1a1c1f;color:#ffffff;font-size:13px;font-weight:500;line-height:18px;text-decoration:none">Open the dashboard</a>` +
    `</td>` +
    `</tr>` +
    `</table>` +

    // Minimal 1-line Footer
    `<table role="presentation" class="divider-top" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #ededed;padding-top:14px">` +
    `<tr>` +
    `<td align="left" class="muted" style="padding-top:14px;font-size:12px;line-height:16px;color:#767676">EGM Growth Dashboard</td>` +
    `<td align="right" class="muted" style="padding-top:14px;font-size:12px;line-height:16px;color:#767676"><a href="${dashboardUrl}" class="muted-link" style="color:#767676;text-decoration:underline;text-underline-offset:3px">egm.n3wth.com</a></td>` +
    `</tr>` +
    `</table>` +

    `</td></tr></table>` +
    `</td></tr></table>` +
    `</body></html>`

  return { subject, text: textLines.join('\n'), html, isoWeek: s.isoWeek }
}

export function growthUpdateEmailPreview(snapshot, scheme = 'light', options = {}) {
  const { html } = buildGrowthUpdateEmail(snapshot, options)
  const chrome = scheme === 'dark' ? '#181818' : '#ffffff'
  const darkForced = scheme === 'dark'
    ? `.card{border-color:#303030 !important}` +
      `.heading,.primary-link,.metric-val{color:#f5f5f5 !important}` +
      `.primary-link{text-decoration-color:#303030 !important}` +
      `.positive{color:#40c977 !important}` +
      `.muted,.muted-link,.section-label{color:#afafaf !important}` +
      `.divider-band{border-top-color:#303030 !important;border-bottom-color:#303030 !important}` +
      `.divider-top{border-top-color:#303030 !important}` +
      `.logo-light,.img-light{display:none !important;max-height:0 !important;overflow:hidden !important}` +
      `.logo-dark,.img-dark{display:block !important;max-height:none !important;overflow:visible !important}` +
      `.button-primary a{background-color:#f5f5f5 !important;color:#181818 !important}`
    : ''
  const style = `<style>html{background-color:${chrome}}body{background:transparent !important;background-color:transparent !important}${darkForced}</style>`
  return html.replace('</head>', `${style}</head>`)
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

export async function sendGrowthUpdateEmail(env, { recipient = defaultGrowthRecipient, idempotencySuffix = 'v4', force = false, images = [] } = {}, fetcher = fetch) {
  if (!env?.RESEND_API_KEY) return { status: 'missing_api_key' }
  const cleanRecipient = String(recipient).trim().toLowerCase()
  if (cleanRecipient !== defaultGrowthRecipient) return { status: 'recipient_not_allowed' }

  await ensureGrowthEmailTable(env)
  const snapshot = await loadCurrentSnapshot(env)
  const summary = extractGrowthSummary(snapshot)
  const llmInsight = await generateGrowthEmailInsight(env, summary, fetcher)
  const email = buildGrowthUpdateEmail(snapshot, { images, insightLine: llmInsight || summary.oneLineInsight })
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
