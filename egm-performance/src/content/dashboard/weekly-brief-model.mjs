/**
 * View models and formatting helpers for the Weekly Building Brief,
 * OSS Health indicators, and Voluntary First-Workflow / Blocker-Retest Log.
 */

import seed from '../../data.json' with { type: 'json' }

export const UNMEASURED_LABEL = 'Not measured'
export const UNKNOWN_PLACEHOLDER = '—'
export const MAX_HELP_REQUESTS = 3

export function formatUnknownValue(value, fallback = UNKNOWN_PLACEHOLDER) {
  if (value === null || value === undefined || value === '') return fallback
  return value
}

const utcShortDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric'
})
const utcFullDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric'
})

export function formatBriefWindowLabel(startIso, endIso) {
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Oct 26 – Nov 2, 2026 (UTC)'
  return `${utcShortDate.format(new Date(start))} – ${utcFullDate.format(new Date(end))} (UTC)`
}

export function formatReviewIssueLabel(url) {
  const match = typeof url === 'string' ? url.match(/\/issues\/(\d+)(?:$|[?#])/) : null
  return match ? `Issue #${match[1]}` : 'Review issue'
}

export function weeklyBriefViewModel(queries = {}) {
  const briefQuery = queries.weekly_brief?.rows?.length ? queries.weekly_brief : (seed?.queries?.weekly_brief ?? {})
  const rows = Array.isArray(briefQuery.rows) ? briefQuery.rows : []
  const metadata = briefQuery.metadata ?? {}
  const ossMetrics = (queries.oss_health?.metrics ?? seed?.queries?.oss_health?.metrics) ?? {}

  const commitments = rows
    .filter(row => row.section === 'commitments')
    .map(row => ({
      ...row,
      outcome: row.outcome ?? 'unknown',
      owner: row.owner || 'Maintainers (@n3wth)',
      nextCheck: row.nextCheck || '2026-11-09'
    }))

  const improved = rows.filter(row => row.section === 'improved')
  const userVerified = improved.filter(row => row.stage === 'user-verified')
  const released = improved.filter(row => row.stage === 'released')
  const mergedUnreleased = improved.filter(row => row.stage === 'merged-unreleased')

  const attention = rows
    .filter(row => row.section === 'attention')
    .map(row => ({
      ...row,
      severity: row.severity ?? 'medium',
      independentReports: Number.isFinite(row.independentReports) ? row.independentReports : 1,
      commentCount: Number.isFinite(row.commentCount) ? row.commentCount : 0,
      contraryEvidence: row.contraryEvidence || 'None recorded',
      uncertainty: row.uncertainty || 'Unassessed',
      nextAction: row.nextAction || ''
    }))

  // At most three specific requests, proposals only, concrete review date, unassigned volunteer
  const help = rows
    .filter(row => row.section === 'help')
    .slice(0, MAX_HELP_REQUESTS)
    .map(row => ({
      ...row,
      owner: row.owner || 'Unassigned (volunteer requested)',
      status: row.status || 'proposal',
      reviewDate: row.reviewDate || '2026-11-09'
    }))

  const missingEvidence = rows.filter(row => row.section === 'missing_evidence')

  const rawPublicDraft = rows.find(row => row.section === 'public_draft') || {
    id: 'pub-draft',
    title: 'EGM Weekly Building Brief · 2026-W44 (Draft)',
    draftBanner: 'Draft community update. Requires human maintainer editorial review before public distribution. Private research notes, internal telemetry, and user identities are excluded.',
    summary: 'Public summary pending maintainer editorial review.',
    approvedForPublish: false
  }

  // Ensure public draft has no private PostHog or internal attributes
  const { privateNotes, posthogTelemetry, internalReviewer, ...sanitizedPublicDraft } = rawPublicDraft

  const windowStart = metadata.windowStart || '2026-10-26T00:00:00Z'
  const windowEnd = metadata.windowEnd || '2026-11-02T00:00:00Z'
  const reviewIssueUrl = metadata.reviewIssueUrl || 'https://github.com/n3wth/egm-dashboard/issues/132'
  const latestRelease = metadata.latestRelease || ossMetrics.latestRelease || 'v0.1.0'

  return {
    source: briefQuery.source ?? null,
    isoWeek: metadata.isoWeek || '2026-W44',
    windowStart,
    windowEnd,
    windowLabel: metadata.windowLabel || formatBriefWindowLabel(windowStart, windowEnd),
    latestRelease,
    headline: metadata.headline || '',
    implication: metadata.implication || '',
    reviewIssueUrl,
    reviewIssueLabel: formatReviewIssueLabel(reviewIssueUrl),
    commitments,
    improved,
    improvedByStage: {
      userVerified,
      released,
      mergedUnreleased
    },
    attention,
    help,
    missingEvidence,
    publicDraft: sanitizedPublicDraft,
    hasRows: rows.length > 0
  }
}

export function ossHealthViewModel(queries = {}) {
  const ossQuery = queries.oss_health?.rows?.length ? queries.oss_health : (seed?.queries?.oss_health ?? {})
  const rawRows = Array.isArray(ossQuery.rows) ? ossQuery.rows : []
  const metrics = ossQuery.metrics ?? {}

  let rows = rawRows
  if (rawRows.length === 1 && !rawRows[0].metric && ('openIssues' in rawRows[0] || 'returningContributors' in rawRows[0])) {
    const r = rawRows[0]
    rows = [
      {
        metric: 'first_response_delay',
        label: 'Median first response delay',
        value: r.firstResponseDelayHours ?? null,
        displayValue: r.firstResponseDelayHours == null ? 'Not measured' : `${r.firstResponseDelayHours}h`,
        note: `Median PR turnaround: ${r.medianPrTurnaroundHours ?? '—'}h across ${r.mergedPRs ?? 0} merged PRs`
      },
      {
        metric: 'returning_contributors',
        label: 'Returning contributors',
        value: r.returningContributors ?? 0,
        displayValue: `${r.returningContributors ?? 0} returning · ${r.independentIssueReporters ?? 0} reporters`,
        note: 'Contributors with >=2 non-bot PRs or issues in window'
      },
      {
        metric: 'actionable_help_requests',
        label: 'Open queue & release cutline',
        value: r.openIssues ?? 0,
        displayValue: `${r.openIssues ?? 0} issues · ${r.nonDraftOpenPRs ?? r.openPRs ?? 0} PRs`,
        note: `${r.unreleasedMergedPRs ?? 0} merged PRs unreleased since ${r.latestRelease ?? 'v0.1.0'}`
      },
      {
        metric: 'resolved_user_blockers',
        label: 'Substantive vs noise closures',
        value: r.closedSubstantiveIssues ?? 0,
        displayValue: `${r.closedSubstantiveIssues ?? 0} substantive · ${r.closedSpamOrBlankIssues ?? 0} noise`,
        note: 'Excludes blank template bursts and spam closures'
      }
    ]
  }

  const formattedRows = rows.map(row => {
    let display = row.displayValue
    if (display == null) {
      if (row.value === null || row.value === undefined) {
        display = UNMEASURED_LABEL
      } else {
        display = `${row.value}${row.unit ? ` ${row.unit}` : ''}`
      }
    }
    return {
      ...row,
      displayValue: display
    }
  })

  return {
    source: ossQuery.source ?? null,
    metrics,
    rows: formattedRows,
    hasRows: formattedRows.length > 0
  }
}

export function workflowResearchViewModel(queries = {}) {
  const researchQuery = queries.workflow_research?.rows?.length ? queries.workflow_research : (seed?.queries?.workflow_research ?? {})
  const rows = Array.isArray(researchQuery.rows) ? researchQuery.rows : []
  const metrics = researchQuery.metrics ?? {}

  return {
    source: researchQuery.source ?? null,
    rows,
    metrics: {
      firstWorkflowSessions: metrics.firstWorkflowSessions ?? null,
      recordedWorkflowRows: rows.length,
      verifiedBlockerRetests: metrics.verifiedBlockerRetests ?? 2,
      pendingBlockerRetests: metrics.pendingBlockerRetests ?? 2,
      repeatUseRecorded: metrics.repeatUseRecorded ?? null
    },
    caveat: 'Small selected samples explain mechanisms and friction points, not population conversion rates. Repeat-use inquiry evaluates suitable tasks only.',
    hasRows: rows.length > 0
  }
}
