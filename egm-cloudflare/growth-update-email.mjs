import seed from '../egm-performance/src/data.json' with { type: 'json' }
import { decisionSender, dashboardUrl, logoBlackUrl, logoWhiteUrl } from './decision-email.mjs'

export const defaultGrowthRecipient = 'newth@google.com'
export const repoUrl = 'https://github.com/google/elephant-goldfish-model'
export const websiteUrl = 'https://egm.dev'
export const growthChartLightUrl = `${dashboardUrl}/email/growth-chart-light.png`
export const growthChartDarkUrl = `${dashboardUrl}/email/growth-chart-dark.png`

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

export function linkifyRepoText(rawText, linkClass = 'inline-link', linkStyle = 'color:#111110;text-decoration:underline;text-underline-offset:2px') {
  const cleaned = String(rawText ?? '').replace(/(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}Z/g, '$1 UTC')
  const escaped = escapeHtml(cleaned)
  return escaped.replace(
    /\b(PR|Issue)\s+#(\d+)\b|(?<![/\w])#(\d+)\b|\b(v0\.1\.0)\b|(?<![\w/])@([A-Za-z0-9-]+)\b/g,
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
  const mergedItems = briefRows.filter(row => row.section === 'improved' && row.stage === 'merged-unreleased')
  const attentionItems = briefRows.filter(row => row.section === 'attention')
  const helpItems = briefRows.filter(row => row.section === 'help')
  const commitments = briefRows.filter(row => row.section === 'commitments')
  const verifiedCommitments = commitments.filter(row => row.outcome === 'verified').length

  return {
    isoWeek: briefMeta.isoWeek || '2026-W44',
    windowStart: briefMeta.windowStart ? briefMeta.windowStart.slice(0, 10) : '2026-10-26',
    windowEnd: briefMeta.windowEnd ? briefMeta.windowEnd.slice(0, 10) : '2026-11-02',
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
    mergedItems,
    attentionItems,
    helpItems,
    reviewIssueUrl: briefMeta.reviewIssueUrl || 'https://github.com/n3wth/egm-dashboard/issues/132',
    customImages: Array.isArray(briefMeta.images) ? briefMeta.images : []
  }
}

function renderEmailImageCard(img) {
  const lightSrc = safeHttpsUrl(img.src)
  if (!lightSrc) return ''
  const darkSrc = safeHttpsUrl(img.darkSrc) || lightSrc
  const href = safeHttpsUrl(img.href) || `${dashboardUrl}/overview`
  const alt = escapeHtml(img.alt || 'EGM growth visual')
  const width = Number.isFinite(img.width) ? img.width : 516
  const height = Number.isFinite(img.height) ? img.height : 196
  const caption = img.caption ? `<p class="muted" style="margin:6px 0 0;font-size:11px;line-height:16px;color:#6b6a65;text-align:left">${linkifyRepoText(img.caption, 'muted-link', 'color:#6b6a65;text-decoration:underline')}</p>` : ''

  return (
    `<div style="margin:0 0 22px">` +
    `<a href="${escapeHtml(href)}" style="display:block;text-decoration:none;border:0">` +
    `<img class="img-light chart-img" src="${escapeHtml(lightSrc)}" width="${width}" height="${height}" alt="${alt}" style="display:block;width:100%;max-width:${width}px;height:auto;border:1px solid #e5e4de;border-radius:8px">` +
    `<img class="img-dark chart-img" src="${escapeHtml(darkSrc)}" width="${width}" height="${height}" alt="${alt}" style="display:none;max-height:0;overflow:hidden;width:100%;max-width:${width}px;height:auto;border:1px solid #2e2e2b;border-radius:8px">` +
    `</a>` +
    caption +
    `</div>`
  )
}

function extractIssueTag(url, fallbackPr, fallbackIssue) {
  if (Number.isFinite(fallbackPr) && Number.isFinite(fallbackIssue)) {
    return [
      { label: `PR #${fallbackPr}`, href: `${repoUrl}/pull/${fallbackPr}` },
      { label: `Issue #${fallbackIssue}`, href: `${repoUrl}/issues/${fallbackIssue}` }
    ]
  }
  if (Number.isFinite(fallbackPr)) {
    return [{ label: `PR #${fallbackPr}`, href: `${repoUrl}/pull/${fallbackPr}` }]
  }
  if (Number.isFinite(fallbackIssue)) {
    return [{ label: `Issue #${fallbackIssue}`, href: `${repoUrl}/issues/${fallbackIssue}` }]
  }
  if (typeof url === 'string') {
    const match = url.match(/\/(issues|pull)\/(\d+)/)
    if (match) {
      const kind = match[1] === 'pull' ? 'PR' : 'Issue'
      return [{ label: `${kind} #${match[2]}`, href: url }]
    }
  }
  return []
}

export function buildGrowthUpdateEmail(snapshot, options = {}) {
  const s = extractGrowthSummary(snapshot)
  const starDeltaText = Number.isFinite(s.sevenDayStarDelta) && s.sevenDayStarDelta > 0
    ? ` (+${formatInt(s.sevenDayStarDelta)} over 7 days)`
    : ''
  const subject = `EGM Growth & Weekly Brief (${s.isoWeek}): ${formatInt(s.stars)} stars${starDeltaText}`
  const preheader = `${formatInt(s.stars)} stars${starDeltaText}, ${formatInt(s.visitors)} unique visitors (14d), ${formatInt(s.cloners)} unique cloners, and ${s.isoWeek} maintainer brief.`

  const textLines = [
    `EGM Growth & Weekly Building Brief (${s.isoWeek} · ${s.windowStart} to ${s.windowEnd} UTC)`,
    '',
    `Key takeaway: ${s.headline}`,
    `Next step: ${s.implication}`,
    '',
    'Growth snapshot (14-day rolling GitHub window):',
    `- Total stars: ${formatInt(s.stars)}${starDeltaText} · ${formatInt(s.forks)} forks (${dashboardUrl}/overview)`,
    `- Repo traffic: ${formatInt(s.visitors)} unique visitors · ${formatInt(s.views)} views (${dashboardUrl}/acquisition)`,
    `- Git clones: ${formatInt(s.cloners)} unique cloners · ${formatInt(s.clones)} clones (${dashboardUrl}/adoption)`,
    `- egm.dev referrals: ${formatInt(s.websiteReferralVisitors)} unique visitors · ${formatInt(s.websiteReferralViews)} views (${dashboardUrl}/website)`,
    `- Release cutline: ${s.unreleasedMergedPRs} merged PRs on main since ${s.latestRelease} (${repoUrl}/compare/${s.latestRelease}...main)`,
    `- Commitments verified: ${s.verifiedCommitments} of ${s.totalCommitments} prior commitments verified (${s.reviewIssueUrl})`,
    ...(s.referrers ? [`- Top referrers: ${s.referrers}`] : []),
    '',
    'User-verified improvements:',
    ...s.verifiedItems.map(item => `- ${item.title}: ${item.evidence} (${item.url || repoUrl})`),
    '',
    ...(s.mergedItems.length ? [
      'Merged on main (queued for next release):',
      ...s.mergedItems.map(item => `- ${item.title}: ${item.evidence} (${item.url || repoUrl})`),
      ''
    ] : []),
    'Needs attention:',
    ...s.attentionItems.map(item => `- [${item.severity}] ${item.title}: ${item.nextAction} (${item.url || repoUrl})`),
    '',
    `Open the dashboard: ${dashboardUrl}`,
    `Weekly Building Brief: ${dashboardUrl}/development#weekly-building-brief`,
    `Adoption & retest log: ${dashboardUrl}/adoption#workflow-research`,
    `Review issue: ${s.reviewIssueUrl}`
  ]

  const metricRows = [
    {
      labelHtml: `<a href="${dashboardUrl}/overview" class="row-link" style="color:#575652;text-decoration:none">Total stars</a>`,
      valueHtml: `<a href="${dashboardUrl}/overview" class="val-link" style="color:#111110;text-decoration:none">${escapeHtml(formatInt(s.stars))}${escapeHtml(starDeltaText)} · ${escapeHtml(formatInt(s.forks))} forks</a>`
    },
    {
      labelHtml: `<a href="${dashboardUrl}/acquisition" class="row-link" style="color:#575652;text-decoration:none">Repo traffic (14d)</a>`,
      valueHtml: `<a href="${dashboardUrl}/acquisition" class="val-link" style="color:#111110;text-decoration:none">${escapeHtml(formatInt(s.visitors))} unique visitors · ${escapeHtml(formatInt(s.views))} views</a>`
    },
    {
      labelHtml: `<a href="${dashboardUrl}/adoption" class="row-link" style="color:#575652;text-decoration:none">Git clones (14d)</a>`,
      valueHtml: `<a href="${dashboardUrl}/adoption" class="val-link" style="color:#111110;text-decoration:none">${escapeHtml(formatInt(s.cloners))} unique cloners · ${escapeHtml(formatInt(s.clones))} clones</a>`
    },
    {
      labelHtml: `<a href="${websiteUrl}" class="row-link" style="color:#575652;text-decoration:underline;text-underline-offset:2px">egm.dev</a> <a href="${dashboardUrl}/website" class="row-link" style="color:#575652;text-decoration:none">referrals (14d)</a>`,
      valueHtml: `<a href="${dashboardUrl}/website" class="val-link" style="color:#111110;text-decoration:none">${escapeHtml(formatInt(s.websiteReferralVisitors))} visitors · ${escapeHtml(formatInt(s.websiteReferralViews))} views</a>`
    },
    {
      labelHtml: `<a href="${repoUrl}/compare/${ encodeURIComponent(s.latestRelease) }...main" class="row-link" style="color:#575652;text-decoration:none">Release cutline</a>`,
      valueHtml: `<a href="${repoUrl}/compare/${ encodeURIComponent(s.latestRelease) }...main" class="val-link" style="color:#111110;text-decoration:underline;text-underline-offset:2px">${escapeHtml(String(s.unreleasedMergedPRs))} merged PRs unreleased since ${escapeHtml(s.latestRelease)}</a>`
    },
    {
      labelHtml: `<a href="${escapeHtml(s.reviewIssueUrl)}" class="row-link" style="color:#575652;text-decoration:none">Prior commitments</a>`,
      valueHtml: `<a href="${escapeHtml(s.reviewIssueUrl)}" class="val-link" style="color:#111110;text-decoration:underline;text-underline-offset:2px">${escapeHtml(String(s.verifiedCommitments))} of ${escapeHtml(String(s.totalCommitments))} verified</a> <span class="muted" style="color:#6b6a65">· ${escapeHtml(String(s.openIssues))} open issues</span>`
    }
  ]

  const metricsHtml = metricRows.map((row, idx) => {
    const borderBottom = idx === metricRows.length - 1 ? 'none' : '1px solid #eae9e4'
    return (
      `<tr>` +
      `<td class="cell-label" style="padding:10px 14px;border-bottom:${borderBottom};font-size:13px;line-height:18px;color:#575652;text-align:left">${row.labelHtml}</td>` +
      `<td class="cell-val" style="padding:10px 14px;border-bottom:${borderBottom};font-size:13px;line-height:18px;color:#111110;text-align:right;font-variant-numeric:tabular-nums">${row.valueHtml}</td>` +
      `</tr>`
    )
  }).join('')

  const verifiedRowsHtml = s.verifiedItems.map((item, idx) => {
    const itemHref = safeHttpsUrl(item.url) || `${dashboardUrl}/development#weekly-brief-improved`
    const refs = extractIssueTag(itemHref, item.pr, item.issue)
    const refLinks = refs.map(r => `<a href="${escapeHtml(r.href)}" class="meta-link" style="color:#575652;text-decoration:underline;text-underline-offset:2px">${escapeHtml(r.label)}</a>`).join(' · ')
    const borderBottom = idx === s.verifiedItems.length - 1 ? 'none' : '1px solid #eae9e4'
    return (
      `<tr>` +
      `<td class="item-cell" style="padding:12px 14px;border-bottom:${borderBottom}">` +
      `<div style="margin:0 0 4px;font-size:11px;line-height:16px;color:#6b6a65">` +
      `<span class="badge-verified" style="display:inline-block;padding:1px 7px;border-radius:4px;background-color:#e8f5e9;color:#1b5e20;font-size:11px;font-weight:500;vertical-align:middle">Verified</span>` +
      (refLinks ? `<span style="margin-left:8px;vertical-align:middle">${refLinks}</span>` : '') +
      (item.release ? `<span class="muted" style="margin-left:6px;vertical-align:middle;color:#6b6a65">· ${linkifyRepoText(item.release, 'meta-link', 'color:#575652;text-decoration:underline;text-underline-offset:2px')}</span>` : '') +
      `</div>` +
      `<div style="margin:0 0 3px;font-size:14px;line-height:20px;font-weight:500;color:#111110">` +
      `<a href="${escapeHtml(itemHref)}" class="item-title-link" style="color:#111110;text-decoration:underline;text-underline-offset:2px">${escapeHtml(item.title)}</a>` +
      `</div>` +
      `<div class="muted" style="margin:0;font-size:12px;line-height:18px;color:#575652">${linkifyRepoText(item.evidence, 'meta-link', 'color:#575652;text-decoration:underline;text-underline-offset:2px')}</div>` +
      `</td>` +
      `</tr>`
    )
  }).join('')

  const mergedRowsHtml = s.mergedItems.map((item, idx) => {
    const itemHref = safeHttpsUrl(item.url) || `${dashboardUrl}/development#weekly-brief-improved`
    const refs = extractIssueTag(itemHref, item.pr, item.issue)
    const refLinks = refs.map(r => `<a href="${escapeHtml(r.href)}" class="meta-link" style="color:#575652;text-decoration:underline;text-underline-offset:2px">${escapeHtml(r.label)}</a>`).join(' · ')
    const borderBottom = idx === s.mergedItems.length - 1 ? 'none' : '1px solid #eae9e4'
    return (
      `<tr>` +
      `<td class="item-cell" style="padding:11px 14px;border-bottom:${borderBottom}">` +
      `<div style="margin:0 0 3px;font-size:11px;line-height:16px;color:#6b6a65">` +
      `<span class="badge-merged" style="display:inline-block;padding:1px 7px;border-radius:4px;background-color:#eff6ff;color:#1e40af;font-size:11px;font-weight:500;vertical-align:middle">Merged on main</span>` +
      (refLinks ? `<span style="margin-left:8px;vertical-align:middle">${refLinks}</span>` : '') +
      `</div>` +
      `<div style="margin:0 0 2px;font-size:13px;line-height:19px;font-weight:500;color:#111110">` +
      `<a href="${escapeHtml(itemHref)}" class="item-title-link" style="color:#111110;text-decoration:underline;text-underline-offset:2px">${escapeHtml(item.title)}</a>` +
      `</div>` +
      `<div class="muted" style="margin:0;font-size:12px;line-height:17px;color:#575652">${linkifyRepoText(item.evidence, 'meta-link', 'color:#575652;text-decoration:underline;text-underline-offset:2px')}</div>` +
      `</td>` +
      `</tr>`
    )
  }).join('')

  const attentionRowsHtml = s.attentionItems.map((item, idx) => {
    const itemHref = safeHttpsUrl(item.url) || `${dashboardUrl}/development#weekly-brief-attention`
    const refs = extractIssueTag(itemHref, item.pr, item.issue)
    const refLinks = refs.map(r => `<a href="${escapeHtml(r.href)}" class="meta-link" style="color:#575652;text-decoration:underline;text-underline-offset:2px">${escapeHtml(r.label)}</a>`).join(' · ')
    const isHigh = String(item.severity).toLowerCase() === 'high'
    const severityLabel = isHigh ? 'High severity' : 'Medium severity'
    const badgeClass = isHigh ? 'badge-high' : 'badge-medium'
    const badgeStyle = isHigh
      ? 'display:inline-block;padding:1px 7px;border-radius:4px;background-color:#fef2f2;color:#991b1b;font-size:11px;font-weight:500;vertical-align:middle'
      : 'display:inline-block;padding:1px 7px;border-radius:4px;background-color:#fefce8;color:#854d0e;font-size:11px;font-weight:500;vertical-align:middle'
    const hostMeta = [item.affectedHost, item.affectedVersion].filter(Boolean).join(' · ')
    const borderBottom = idx === s.attentionItems.length - 1 ? 'none' : '1px solid #eae9e4'
    return (
      `<tr>` +
      `<td class="item-cell" style="padding:12px 14px;border-bottom:${borderBottom}">` +
      `<div style="margin:0 0 4px;font-size:11px;line-height:16px;color:#6b6a65">` +
      `<span class="${badgeClass}" style="${badgeStyle}">${escapeHtml(severityLabel)}</span>` +
      (refLinks ? `<span style="margin-left:8px;vertical-align:middle">${refLinks}</span>` : '') +
      (hostMeta ? `<span class="muted" style="margin-left:6px;vertical-align:middle;color:#6b6a65">· ${escapeHtml(hostMeta)}</span>` : '') +
      `</div>` +
      `<div style="margin:0 0 3px;font-size:14px;line-height:20px;font-weight:500;color:#111110">` +
      `<a href="${escapeHtml(itemHref)}" class="item-title-link" style="color:#111110;text-decoration:underline;text-underline-offset:2px">${escapeHtml(item.title)}</a>` +
      `</div>` +
      `<div class="muted" style="margin:0;font-size:12px;line-height:18px;color:#575652">Next step: ${linkifyRepoText(item.nextAction, 'meta-link', 'color:#575652;text-decoration:underline;text-underline-offset:2px')}</div>` +
      `</td>` +
      `</tr>`
    )
  }).join('')

  const allImages = [
    ...(options.includeDefaultChart === false ? [] : [{
      src: growthChartLightUrl,
      darkSrc: growthChartDarkUrl,
      href: `${dashboardUrl}/overview`,
      alt: `EGM cumulative star trajectory and 14-day daily star additions (${s.isoWeek})`,
      caption: `51-day cumulative GitHub star curve and 14-day daily additions. View interactive charts on the dashboard.`,
      width: 516,
      height: 196
    }]),
    ...s.customImages,
    ...(Array.isArray(options.images) ? options.images : [])
  ]
  const imagesHtml = allImages.map(renderEmailImageCard).join('')

  const styles = [
    `@font-face{font-family:'Suisse Intl';font-style:normal;font-weight:400;src:url('${dashboardUrl}/fonts/SuisseIntl-Book.woff2') format('woff2')}`,
    `@font-face{font-family:'Suisse Intl';font-style:normal;font-weight:500;src:url('${dashboardUrl}/fonts/SuisseIntl-Medium.woff2') format('woff2')}`,
    `@font-face{font-family:'Suisse Intl';font-style:normal;font-weight:600;src:url('${dashboardUrl}/fonts/SuisseIntl-Semibold.woff2') format('woff2')}`,
    `:root{color-scheme:light dark;supported-color-schemes:light dark}`,
    `body{margin:0;padding:0;background-color:#f6f5f1;-webkit-font-smoothing:antialiased}`,
    `.logo-dark,.img-dark{display:none !important;max-height:0 !important;overflow:hidden !important}`,
    `@media (prefers-color-scheme:dark){`,
    `body,.email-bg{background-color:#0b0b0a !important}`,
    `.card{background-color:#141413 !important;border-color:#2a2a27 !important}`,
    `.heading,.cell-val,.val-link,.item-title-link,.inline-link{color:#f5f5f3 !important}`,
    `.text{color:#e5e4de !important}`,
    `.muted,.cell-label,.row-link,.meta-link,.muted-link,.eyebrow{color:#a3a29c !important}`,
    `.week-pill{background-color:#1f1f1d !important;border-color:#33332f !important;color:#d6d5ce !important}`,
    `.callout{background-color:#1b1b19 !important;border-color:#2e2e2b !important}`,
    `.table-box{background-color:#171715 !important;border-color:#2c2c29 !important}`,
    `.cell-label,.cell-val,.item-cell{border-bottom-color:#262623 !important}`,
    `.chart-img{border-color:#2e2e2b !important}`,
    `.badge-verified{background-color:#142e1b !important;color:#86efac !important}`,
    `.badge-merged{background-color:#172554 !important;color:#93c5fd !important}`,
    `.badge-high{background-color:#3b1414 !important;color:#fca5a5 !important}`,
    `.badge-medium{background-color:#36280f !important;color:#fde047 !important}`,
    `.logo-light,.img-light{display:none !important;max-height:0 !important;overflow:hidden !important}`,
    `.logo-dark,.img-dark{display:block !important;max-height:none !important;overflow:visible !important}`,
    `.button-primary a{background-color:#f5f5f3 !important;color:#111110 !important}`,
    `.button-secondary a{background-color:#1c1c1a !important;color:#f5f5f3 !important;border-color:#33332f !important}`,
    `.footer-divider{border-top-color:#262623 !important}`,
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
    `<body class="email-bg" style="margin:0;padding:0;background-color:#f6f5f1;font-family:${font}">` +
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</div>` +
    `<table role="presentation" class="email-bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f6f5f1">` +
    `<tr><td align="center" style="padding:28px 12px">` +
    `<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;background-color:#ffffff;border:1px solid #e5e4de;border-radius:12px;border-collapse:separate">` +
    `<tr><td style="padding:28px 30px">` +

    // Top bar: Logo left, Week badge right
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">` +
    `<tr>` +
    `<td align="left" valign="middle">` +
    `<a href="${dashboardUrl}" style="display:inline-block;text-decoration:none;border:0">` +
    `<img class="logo-light" src="${logoBlackUrl}" width="48" height="28" alt="EGM" style="display:block;width:48px;height:28px;border:0">` +
    `<img class="logo-dark" src="${logoWhiteUrl}" width="48" height="28" alt="EGM" style="display:none;max-height:0;overflow:hidden;width:48px;height:28px;border:0">` +
    `</a>` +
    `</td>` +
    `<td align="right" valign="middle">` +
    `<a href="${dashboardUrl}/development#weekly-building-brief" class="week-pill" style="display:inline-block;padding:4px 10px;border:1px solid #e5e4de;border-radius:999px;background-color:#faf9f5;color:#575652;font-size:11px;font-weight:500;line-height:16px;text-decoration:none">${escapeHtml(s.isoWeek)} · ${escapeHtml(s.windowStart.slice(5))} to ${escapeHtml(s.windowEnd.slice(5))} UTC</a>` +
    `</td>` +
    `</tr>` +
    `</table>` +

    // Eyebrow + Hero Headline + Subtitle
    `<p class="eyebrow" style="margin:0 0 4px;font-size:11px;line-height:16px;font-weight:600;color:#6b6a65;text-transform:uppercase;letter-spacing:0.06em">Weekly Growth &amp; Building Brief</p>` +
    `<h1 class="heading" style="margin:0 0 6px;font-size:24px;line-height:32px;font-weight:600;letter-spacing:-0.02em;color:#111110">${escapeHtml(formatInt(s.stars))} stars${escapeHtml(starDeltaText)}</h1>` +
    `<p class="muted" style="margin:0 0 20px;font-size:13px;line-height:20px;color:#575652">14-day reach, adoption, and maintainer brief for <a href="${repoUrl}" class="meta-link" style="color:#575652;text-decoration:underline;text-underline-offset:2px">google/elephant-goldfish-model</a> and <a href="${websiteUrl}" class="meta-link" style="color:#575652;text-decoration:underline;text-underline-offset:2px">egm.dev</a>.</p>` +

    // Executive Summary Callout (no mid-sentence bolding)
    `<div class="callout" style="margin:0 0 22px;padding:16px 18px;border:1px solid #e5e4de;border-radius:8px;background-color:#faf9f5">` +
    `<div class="eyebrow" style="margin:0 0 4px;font-size:10px;line-height:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b6a65">Key takeaway</div>` +
    `<p class="text" style="margin:0 0 12px;font-size:13px;line-height:20px;color:#171716">${linkifyRepoText(s.headline)}</p>` +
    `<div class="eyebrow" style="margin:0 0 4px;font-size:10px;line-height:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b6a65">Recommended next step</div>` +
    `<p class="text" style="margin:0;font-size:13px;line-height:20px;color:#171716">${linkifyRepoText(s.implication)}</p>` +
    `</div>` +

    // Visual Chart + Optional Images
    imagesHtml +

    // Growth & Release Snapshot Table
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px">` +
    `<tr>` +
    `<td align="left"><h2 class="heading" style="margin:0;font-size:14px;line-height:20px;font-weight:600;color:#111110">Growth &amp; release snapshot</h2></td>` +
    `<td align="right"><a href="${dashboardUrl}/overview" class="meta-link" style="font-size:12px;line-height:18px;color:#575652;text-decoration:underline;text-underline-offset:2px">Live overview</a></td>` +
    `</tr>` +
    `</table>` +
    `<table role="presentation" class="table-box" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background-color:#ffffff;border:1px solid #e5e4de;border-radius:8px;border-collapse:separate;overflow:hidden">${metricsHtml}</table>` +

    // User-verified improvements
    (verifiedRowsHtml ? (
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px">` +
      `<tr>` +
      `<td align="left"><h2 class="heading" style="margin:0;font-size:14px;line-height:20px;font-weight:600;color:#111110">User-verified improvements</h2></td>` +
      `<td align="right"><a href="${dashboardUrl}/development#weekly-brief-improved" class="meta-link" style="font-size:12px;line-height:18px;color:#575652;text-decoration:underline;text-underline-offset:2px">All shipped items</a></td>` +
      `</tr>` +
      `</table>` +
      `<table role="presentation" class="table-box" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background-color:#ffffff;border:1px solid #e5e4de;border-radius:8px;border-collapse:separate;overflow:hidden">${verifiedRowsHtml}</table>`
    ) : '') +

    // Merged on main (unreleased)
    (mergedRowsHtml ? (
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px">` +
      `<tr>` +
      `<td align="left"><h2 class="heading" style="margin:0;font-size:14px;line-height:20px;font-weight:600;color:#111110">Merged on main (queued for next release)</h2></td>` +
      `<td align="right"><a href="${repoUrl}/compare/${encodeURIComponent(s.latestRelease)}...main" class="meta-link" style="font-size:12px;line-height:18px;color:#575652;text-decoration:underline;text-underline-offset:2px">Compare ${escapeHtml(s.latestRelease)}...main</a></td>` +
      `</tr>` +
      `</table>` +
      `<table role="presentation" class="table-box" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;background-color:#ffffff;border:1px solid #e5e4de;border-radius:8px;border-collapse:separate;overflow:hidden">${mergedRowsHtml}</table>`
    ) : '') +

    // Needs attention
    (attentionRowsHtml ? (
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px">` +
      `<tr>` +
      `<td align="left"><h2 class="heading" style="margin:0;font-size:14px;line-height:20px;font-weight:600;color:#111110">Needs attention</h2></td>` +
      `<td align="right"><a href="${dashboardUrl}/adoption#workflow-research" class="meta-link" style="font-size:12px;line-height:18px;color:#575652;text-decoration:underline;text-underline-offset:2px">Blocker retest log</a></td>` +
      `</tr>` +
      `</table>` +
      `<table role="presentation" class="table-box" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;background-color:#ffffff;border:1px solid #e5e4de;border-radius:8px;border-collapse:separate;overflow:hidden">${attentionRowsHtml}</table>`
    ) : '') +

    // Action Buttons
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">` +
    `<tr>` +
    `<td class="button-primary" align="left" style="border-radius:6px;padding-right:10px">` +
    `<a href="${dashboardUrl}" style="display:inline-block;padding:11px 18px;border-radius:6px;background-color:#111110;color:#ffffff;font-size:13px;font-weight:600;line-height:18px;text-decoration:none">Open the dashboard</a>` +
    `</td>` +
    `<td class="button-secondary" align="left" style="border-radius:6px">` +
    `<a href="${dashboardUrl}/development#weekly-building-brief" style="display:inline-block;padding:10px 16px;border-radius:6px;border:1px solid #d5d3cb;background-color:#faf9f5;color:#111110;font-size:13px;font-weight:500;line-height:18px;text-decoration:none">Review weekly brief</a>` +
    `</td>` +
    `</tr>` +
    `</table>` +

    // Footer links (thin border-top on footer container, no <hr>)
    `<div class="footer-divider" style="padding-top:16px;border-top:1px solid #eae9e4">` +
    `<p class="muted" style="margin:0 0 6px;font-size:12px;line-height:18px;color:#6b6a65">` +
    `<a href="${dashboardUrl}/overview" class="muted-link" style="color:#575652;text-decoration:underline;text-underline-offset:2px">Overview</a> · ` +
    `<a href="${dashboardUrl}/acquisition" class="muted-link" style="color:#575652;text-decoration:underline;text-underline-offset:2px">Acquisition</a> · ` +
    `<a href="${dashboardUrl}/adoption" class="muted-link" style="color:#575652;text-decoration:underline;text-underline-offset:2px">Adoption</a> · ` +
    `<a href="${dashboardUrl}/development" class="muted-link" style="color:#575652;text-decoration:underline;text-underline-offset:2px">Development</a> · ` +
    `<a href="${escapeHtml(s.reviewIssueUrl)}" class="muted-link" style="color:#575652;text-decoration:underline;text-underline-offset:2px">GitHub review issue</a>` +
    `</p>` +
    `<p class="muted" style="margin:0;font-size:11px;line-height:16px;color:#6b6a65">EGM Growth Dashboard · <a href="${dashboardUrl}" class="muted-link" style="color:#6b6a65;text-decoration:underline;text-underline-offset:2px">egm.n3wth.com</a></p>` +
    `</div>` +

    `</td></tr></table>` +
    `</td></tr></table>` +
    `</body></html>`

  return { subject, text: textLines.join('\n'), html, isoWeek: s.isoWeek }
}

export function growthUpdateEmailPreview(snapshot, scheme = 'light', options = {}) {
  const { html } = buildGrowthUpdateEmail(snapshot, options)
  if (scheme !== 'dark') return html
  const darkOverrides =
    `<style>` +
    `html,body,.email-bg{background-color:#0b0b0a !important}` +
    `.card{background-color:#141413 !important;border-color:#2a2a27 !important}` +
    `.heading,.cell-val,.val-link,.item-title-link,.inline-link{color:#f5f5f3 !important}` +
    `.text{color:#e5e4de !important}` +
    `.muted,.cell-label,.row-link,.meta-link,.muted-link,.eyebrow{color:#a3a29c !important}` +
    `.week-pill{background-color:#1f1f1d !important;border-color:#33332f !important;color:#d6d5ce !important}` +
    `.callout{background-color:#1b1b19 !important;border-color:#2e2e2b !important}` +
    `.table-box{background-color:#171715 !important;border-color:#2c2c29 !important}` +
    `.cell-label,.cell-val,.item-cell{border-bottom-color:#262623 !important}` +
    `.chart-img{border-color:#2e2e2b !important}` +
    `.badge-verified{background-color:#142e1b !important;color:#86efac !important}` +
    `.badge-merged{background-color:#172554 !important;color:#93c5fd !important}` +
    `.badge-high{background-color:#3b1414 !important;color:#fca5a5 !important}` +
    `.badge-medium{background-color:#36280f !important;color:#fde047 !important}` +
    `.logo-light,.img-light{display:none !important;max-height:0 !important;overflow:hidden !important}` +
    `.logo-dark,.img-dark{display:block !important;max-height:none !important;overflow:visible !important}` +
    `.button-primary a{background-color:#f5f5f3 !important;color:#111110 !important}` +
    `.button-secondary a{background-color:#1c1c1a !important;color:#f5f5f3 !important;border-color:#33332f !important}` +
    `.footer-divider{border-top-color:#262623 !important}` +
    `</style>`
  return html.replace('</head>', `${darkOverrides}</head>`)
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

export async function sendGrowthUpdateEmail(env, { recipient = defaultGrowthRecipient, idempotencySuffix = 'v2', force = false, images = [] } = {}, fetcher = fetch) {
  if (!env?.RESEND_API_KEY) return { status: 'missing_api_key' }
  const cleanRecipient = String(recipient).trim().toLowerCase()
  if (cleanRecipient !== defaultGrowthRecipient) return { status: 'recipient_not_allowed' }

  await ensureGrowthEmailTable(env)
  const snapshot = await loadCurrentSnapshot(env)
  const email = buildGrowthUpdateEmail(snapshot, { images })
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
