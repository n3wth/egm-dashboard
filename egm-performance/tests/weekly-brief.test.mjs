import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

import {
  weeklyBriefViewModel,
  ossHealthViewModel,
  workflowResearchViewModel,
  MAX_HELP_REQUESTS,
  UNMEASURED_LABEL
} from '../src/content/dashboard/weekly-brief-model.mjs'

test('weekly brief view model partitions real W44 stages, bounds help proposals, and enforces caveats', () => {
  const snapshot = JSON.parse(readFileSync('src/data.json', 'utf8'))
  const brief = weeklyBriefViewModel(snapshot.queries)

  // Metadata
  assert.equal(brief.isoWeek, '2026-W44')
  assert.ok(brief.headline.includes('Release v0.1.0 lags main by 24 in-window merged PRs'))
  assert.ok(brief.implication.includes('Cutting a patch release (v0.1.1)'))

  // 1. Commitments (4 real W44 actions)
  assert.equal(brief.commitments.length, 4, 'contains 4 commitments')
  assert.ok(brief.commitments.some(c => c.outcome === 'verified'), 'has verified commitment')
  assert.ok(brief.commitments.some(c => c.outcome === 'unknown'), 'has unknown commitment')
  assert.ok(brief.commitments.some(c => c.outcome === 'contradicted'), 'has contradicted commitment')

  // 2. What improved (8 real items across 3 stages)
  assert.equal(brief.improved.length, 8, 'contains 8 improved rows')
  assert.equal(brief.improvedByStage.userVerified.length, 2, '2 user-verified items (#193/#194 and #274)')
  assert.equal(brief.improvedByStage.released.length, 3, '3 released v0.1.0 items')
  assert.equal(brief.improvedByStage.mergedUnreleased.length, 3, '3 merged-unreleased items on main')
  assert.equal(
    brief.improved.length,
    brief.improvedByStage.userVerified.length +
      brief.improvedByStage.released.length +
      brief.improvedByStage.mergedUnreleased.length,
    'all improved items are partitioned into the 3 stages'
  )

  // 3. What needs attention (4 real blockers)
  assert.equal(brief.attention.length, 4, '4 reproducible blockers')
  assert.ok(brief.attention.some(a => a.url.includes('/272')), 'issue #272 present')
  assert.ok(brief.attention.some(a => a.url.includes('/196')), 'issues #196/220/254 present')
  assert.ok(brief.attention.some(a => a.url.includes('/238')), 'issue #238 present')
  assert.ok(brief.attention.some(a => a.url.includes('/261')), 'issue #261 present')
  for (const item of brief.attention) {
    assert.ok(['high', 'medium', 'low'].includes(item.severity), 'severity is high/medium/low')
    assert.ok(Number.isInteger(item.independentReports), 'independent reports is integer')
    assert.ok(Number.isInteger(item.commentCount), 'comment count is integer')
    assert.ok(item.contraryEvidence, 'contrary evidence is specified')
    assert.ok(item.uncertainty, 'uncertainty is specified')
  }

  // 4. Where you can help (strictly 3 proposals)
  assert.ok(brief.help.length <= MAX_HELP_REQUESTS, 'help requests strictly <= 3')
  for (const item of brief.help) {
    assert.match(item.owner, /Unassigned/, 'volunteer help proposals have unassigned owner')
    assert.equal(item.status, 'proposal', 'status is proposal')
    assert.equal(item.reviewDate, '2026-11-09', 'review date is 2026-11-09')
  }

  // 5. Missing evidence (3 questions)
  assert.equal(brief.missingEvidence.length, 3, '3 missing evidence items present')
  for (const item of brief.missingEvidence) {
    assert.ok(item.unresolvedQuestion, 'unresolved question is present')
    assert.ok(item.smallestObservation, 'smallest observation is present')
  }

  // Public draft
  assert.ok(brief.publicDraft.draftBanner, 'public draft requires editorial review banner')
  assert.equal(brief.publicDraft.posthogTelemetry, undefined, 'no posthog telemetry in public draft')
  assert.equal(brief.publicDraft.privateNotes, undefined, 'no private notes in public draft')
})

test('oss health view model reports real W44 metrics without zero substitution', () => {
  const snapshot = JSON.parse(readFileSync('src/data.json', 'utf8'))
  const health = ossHealthViewModel(snapshot.queries)

  assert.ok(health.rows.length >= 4, 'contains health metrics')
  const responseMetric = health.rows.find(r => r.metric === 'first_response_time')
  const reviewMetric = health.rows.find(r => r.metric === 'pr_review_turnaround')
  assert.equal(responseMetric.displayValue, UNMEASURED_LABEL, 'first response time displays Not measured')
  assert.equal(reviewMetric.displayValue, '1.8 hours', 'pr review turnaround displays 1.8 hours')
  assert.notEqual(responseMetric.displayValue, '0', 'unmeasured latency is never 0')
  assert.notEqual(responseMetric.displayValue, '0 hours', 'unmeasured latency is never 0')

  assert.equal(health.metrics.openIssues, 40)
  assert.equal(health.metrics.openPRs, 20)
  assert.equal(health.metrics.mergedPRs, 41)
  assert.equal(health.metrics.returningContributors, 5)
  assert.equal(health.metrics.resolvedUserBlockers, 2)
})

test('workflow research view model reports real blocker retests and unmeasured session metrics', () => {
  const snapshot = JSON.parse(readFileSync('src/data.json', 'utf8'))
  const research = workflowResearchViewModel(snapshot.queries)

  assert.equal(research.metrics.firstWorkflowSessions, null, 'first workflow sessions is null/unmeasured')
  assert.equal(research.metrics.repeatUseRecorded, null, 'repeat use is null/unmeasured')
  assert.equal(research.metrics.verifiedBlockerRetests, 2, '2 verified blocker retests')
  assert.equal(research.metrics.pendingBlockerRetests, 2, '2 pending blocker retests')
  assert.equal(research.rows.length, 5, '5 real public GitHub friction records')
  assert.match(research.caveat, /mechanisms.*not.*conversion rates/i, 'includes mechanisms caveat')

  for (const row of research.rows) {
    assert.equal(row.repeatUse, 'unknown', 'repeat use is unknown pending follow-up check')
  }
})

test('rendered dashboard components bind provenance, toolbar, and preserve adoption measurement gaps', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { DataAppShell } = await server.ssrLoadModule('/src/DataAppShell.jsx')
    const { DashboardContent } = await server.ssrLoadModule('/src/content/dashboard/DashboardContent.jsx')
    const { WeeklyBriefSection, OssHealthSection, WorkflowResearchSection } = await server.ssrLoadModule(
      '/src/content/dashboard/WeeklyBrief.jsx'
    )
    const snapshot = JSON.parse(readFileSync('src/data.json', 'utf8'))

    // 1. Direct component render tests
    const briefHtml = renderToStaticMarkup(
      React.createElement(
        DataAppShell,
        { snapshot, hosted: false, persistLocally: false },
        React.createElement(WeeklyBriefSection, { queries: snapshot.queries })
      )
    )
    assert.match(briefHtml, /data-query-id="weekly_brief"/, 'WeeklyBriefSection binds weekly_brief provenance')
    assert.match(briefHtml, /class="egm-brief-toolbar"/, 'Dedicated responsive toolbar rendered')
    assert.match(briefHtml, /Close last week.*commitments/, 'Commitments header rendered')
    assert.match(briefHtml, /User-verified/, 'User-verified stage badge rendered')
    assert.match(briefHtml, /Released \(v0\.1\.0\)/, 'Released stage badge rendered')
    assert.match(briefHtml, /Merged on main/, 'Merged stage badge rendered')
    assert.match(briefHtml, /Where you can help/, 'Help proposals section rendered')
    assert.match(briefHtml, /Missing evidence/, 'Missing evidence section rendered')
    assert.match(briefHtml, /Internal brief \(draft\)/, 'View switcher contains internal brief option')
    assert.match(briefHtml, /Public-safe draft \(requires review\)/, 'View switcher contains public draft option')

    const healthHtml = renderToStaticMarkup(
      React.createElement(
        DataAppShell,
        { snapshot, hosted: false, persistLocally: false },
        React.createElement(OssHealthSection, { queries: snapshot.queries })
      )
    )
    assert.match(healthHtml, /data-query-id="oss_health"/, 'OssHealthSection binds oss_health provenance')
    assert.match(healthHtml, /Open source project health/, 'Health title rendered')
    assert.match(healthHtml, /Not measured/, 'Unmeasured metrics render Not measured')
    assert.match(healthHtml, /1\.8 hours/, 'Measured PR turnaround renders 1.8 hours')

    const researchHtml = renderToStaticMarkup(
      React.createElement(
        DataAppShell,
        { snapshot, hosted: false, persistLocally: false },
        React.createElement(WorkflowResearchSection, { queries: snapshot.queries })
      )
    )
    assert.match(researchHtml, /data-query-id="workflow_research"/, 'WorkflowResearchSection binds workflow_research')
    assert.match(researchHtml, /Voluntary first-workflow and blocker-retest log/, 'Research log title rendered')
    assert.match(researchHtml, /Small selected samples explain mechanisms/, 'Mechanism caveat rendered')
    assert.match(researchHtml, /class="stat-value stat-unmeasured">Not measured/, 'Unmeasured session counts render Not measured')

    // 2. Tab Integration: Adoption Tab
    const adoptionHtml = renderToStaticMarkup(
      React.createElement(
        DataAppShell,
        {
          snapshot,
          hosted: true,
          persistLocally: false,
          initialPresentation: { tabs: [{ id: 'adoption', label: 'Adoption' }] }
        },
        React.createElement(DashboardContent)
      )
    )
    assert.match(
      adoptionHtml,
      /First successful workflow<\/dt><dd>Not measured/,
      'Adoption measurement gap dl preserved intact'
    )
    assert.match(
      adoptionHtml,
      /Repeat use after seven days<\/dt><dd>Not measured/,
      'Repeat use dl preserved intact'
    )
    assert.match(
      adoptionHtml,
      /data-component-id="adoption-workflow-research"/,
      'Workflow research component rendered on adoption tab'
    )
    assert.ok(
      adoptionHtml.indexOf('First use and repeat use') < adoptionHtml.indexOf('Voluntary first-workflow'),
      'Measurement gap card appears above voluntary workflow research card'
    )

    // 3. Tab Integration: Development Tab
    const devHtml = renderToStaticMarkup(
      React.createElement(
        DataAppShell,
        {
          snapshot,
          hosted: true,
          persistLocally: false,
          initialPresentation: { tabs: [{ id: 'development', label: 'Development' }] }
        },
        React.createElement(DashboardContent)
      )
    )
    assert.match(devHtml, /data-component-id="weekly-brief-commitments"/, 'Weekly brief rendered on development tab')
    assert.match(devHtml, /data-component-id="oss-health-metrics"/, 'OSS health rendered on development tab')
    assert.match(devHtml, /data-component-id="open-issues"/, 'Existing open-issues card still rendered')
  } finally {
    await server.close()
  }
})


test('ossHealthViewModel adapts 1-row live GitHub snapshot shape into 4 display metrics', () => {
  const liveRow = {
    openIssues: 42,
    openPRs: 7,
    nonDraftOpenPRs: 5,
    oldestOpenPrDays: 4,
    mergedPRs: 24,
    medianPrTurnaroundHours: 3.5,
    firstResponseDelayHours: null,
    latestRelease: 'v0.1.0',
    releasedMergedPRs: 8,
    unreleasedMergedPRs: 24,
    returningContributors: 9,
    independentIssueReporters: 6,
    closedSpamOrBlankIssues: 2,
    closedSubstantiveIssues: 14
  }
  const model = ossHealthViewModel({ oss_health: { rows: [liveRow] } })
  assert.equal(model.rows.length, 4)
  assert.equal(model.rows[0].metric, 'first_response_delay')
  assert.equal(model.rows[0].displayValue, 'Not measured')
  assert.equal(model.rows[1].metric, 'returning_contributors')
  assert.equal(model.rows[1].displayValue, '9 returning · 6 reporters')
  assert.equal(model.rows[2].metric, 'actionable_help_requests')
  assert.equal(model.rows[2].displayValue, '42 issues · 5 PRs')
  assert.equal(model.rows[3].metric, 'resolved_user_blockers')
  assert.equal(model.rows[3].displayValue, '14 substantive · 2 noise')
})

test('renders adoption and development tabs without throwing when snapshot lacks weekly_brief, oss_health, workflow_research, or traffic_history', async () => {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom'
  })
  try {
    const rawSnapshot = JSON.parse(readFileSync('src/data.json', 'utf8'))
    // Clone snapshot and strip the 4 queries to simulate pre-existing D1 snapshot
    const { weekly_brief, oss_health, workflow_research, traffic_history, ...legacyQueries } = rawSnapshot.queries
    const legacySnapshot = {
      ...rawSnapshot,
      queries: legacyQueries
    }

    const { DataAppShell } = await server.ssrLoadModule('/src/DataAppShell.jsx')
    const { DashboardContent } = await server.ssrLoadModule(
      '/src/content/dashboard/DashboardContent.jsx'
    )

    // Render adoption tab with legacy queries
    assert.doesNotThrow(() => {
      const adoptionHtml = renderToStaticMarkup(
        React.createElement(
          DataAppShell,
          {
            snapshot: legacySnapshot,
            hosted: true,
            persistLocally: false,
            initialPresentation: { tabs: [{ id: 'adoption', label: 'Adoption' }] }
          },
          React.createElement(DashboardContent)
        )
      )
      assert.match(adoptionHtml, /data-component-id="adoption-workflow-research"/)
    })

    // Render development tab with legacy queries
    assert.doesNotThrow(() => {
      const devHtml = renderToStaticMarkup(
        React.createElement(
          DataAppShell,
          {
            snapshot: legacySnapshot,
            hosted: true,
            persistLocally: false,
            initialPresentation: { tabs: [{ id: 'development', label: 'Development' }] }
          },
          React.createElement(DashboardContent)
        )
      )
      assert.match(devHtml, /data-component-id="weekly-brief-commitments"/)
      assert.match(devHtml, /data-component-id="oss-health-metrics"/)
    })
  } finally {
    await server.close()
  }
})

test('egm.css has no bold Suisse font, no font-weight 700, no italic, caps chart height, and tables have no strong cells', async () => {
  const css = readFileSync('src/content/dashboard/egm.css', 'utf8')
  assert.doesNotMatch(css, /SuisseIntl-Bold\.woff2/, 'SuisseIntl-Bold.woff2 must not be referenced in egm.css')
  assert.doesNotMatch(css, /font-weight:\s*700/, 'font-weight: 700 must not exist in egm.css')
  assert.doesNotMatch(css, /font-style:\s*italic/, 'font-style: italic must not exist in egm.css')
  assert.match(css, /\.egm-time-series\s+\.chart-frame\s*\{[^}]*max-height:\s*280px/, '.egm-time-series .chart-frame must cap max-height on desktop')

  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { DataAppShell } = await server.ssrLoadModule('/src/DataAppShell.jsx')
    const { WeeklyBriefSection, WorkflowResearchSection } = await server.ssrLoadModule(
      '/src/content/dashboard/WeeklyBrief.jsx'
    )
    const snapshot = JSON.parse(readFileSync('src/data.json', 'utf8'))

    const briefHtml = renderToStaticMarkup(
      React.createElement(
        DataAppShell,
        { snapshot, hosted: false, persistLocally: false },
        React.createElement(WeeklyBriefSection, { queries: snapshot.queries })
      )
    )
    // Verify table cells do not wrap content in <strong>
    assert.doesNotMatch(briefHtml, /<td[^>]*>\s*<strong/, 'WeeklyBriefSection table cells must not contain strong')

    const researchHtml = renderToStaticMarkup(
      React.createElement(
        DataAppShell,
        { snapshot, hosted: false, persistLocally: false },
        React.createElement(WorkflowResearchSection, { queries: snapshot.queries })
      )
    )
    assert.doesNotMatch(researchHtml, /<td[^>]*>\s*<strong/, 'WorkflowResearchSection table cells must not contain strong')
  } finally {
    await server.close()
  }
})
