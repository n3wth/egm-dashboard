import React, { useState } from 'react'
import { DataComponent, Icon, SegmentedControl } from '../../data-app-public.jsx'
import { safeExternalUrl } from './research-mentions.mjs'
import { weeklyBriefViewModel, ossHealthViewModel, workflowResearchViewModel } from './weekly-brief-model.mjs'

export function WeeklyBriefSection({ queries = {} }) {
  const [viewMode, setViewMode] = useState('internal')
  const brief = weeklyBriefViewModel(queries)
  const activeQueryId = queries.weekly_brief ? 'weekly_brief' : (queries.maintenance ? 'maintenance' : Object.keys(queries)[0] || 'weekly_brief')
  const sourceRows = queries[activeQueryId]?.rows ?? []

  const viewOptions = [
    { value: 'internal', label: 'Internal brief (draft)' },
    { value: 'public', label: 'Public-safe draft (requires review)' }
  ]

  return (
    <section id="weekly-building-brief" className="egm-weekly-brief-container" data-brief-mode={viewMode}>
      <div className="egm-brief-toolbar">
        <div className="egm-brief-toolbar-meta">
          <span className="egm-brief-pill">{brief.isoWeek}</span>
          <span className="egm-brief-dates">{brief.windowLabel}</span>
          {brief.reviewIssueUrl && (
            <a
              href={brief.reviewIssueUrl}
              target="_blank"
              rel="noreferrer"
              className="egm-brief-review-link"
            >
              {brief.reviewIssueLabel} <Icon name="arrowUpRight" size={12} />
            </a>
          )}
        </div>
        <SegmentedControl
          ariaLabel="Brief view mode"
          value={viewMode}
          onChange={setViewMode}
          options={viewOptions}
        />
      </div>

      {brief.headline && (
        <aside className="egm-brief-headline-card" role="region" aria-label="Executive summary">
          <div className="egm-headline-main">
            <strong>Key takeaway:</strong> {brief.headline}
          </div>
          {brief.implication && (
            <div className="egm-headline-implication">
              <strong>Implication:</strong> {brief.implication}
            </div>
          )}
        </aside>
      )}

      {viewMode === 'public' && (
        <DataComponent
          id="weekly-brief-public-draft"
          queryId={activeQueryId}
          title="Weekly building brief · Public-safe draft"
          kind="custom"
          variant="card"
          displayRows={[brief.publicDraft]}
          sourceRowsByQuery={{ [activeQueryId]: sourceRows }}
        >
          <div className="egm-public-draft-card" data-reviewed-rows>
            <aside className="egm-public-draft-banner" role="status" aria-label="Editorial review requirement">
              <div className="egm-banner-header">
                <Icon name="info" size={16} />
                <strong>Draft community update · Requires editorial review</strong>
              </div>
              <p>{brief.publicDraft.draftBanner}</p>
            </aside>

            <article className="egm-public-draft-content">
              <h3>{brief.publicDraft.title}</h3>
              <p className="egm-draft-summary">{brief.publicDraft.summary}</p>

              <h4>Publicly verified improvements</h4>
              <ul className="egm-draft-improvements">
                {brief.improvedByStage.userVerified.map(item => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>: {item.evidence}
                  </li>
                ))}
                {brief.improvedByStage.released.map(item => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>: Shipped in {item.release}
                  </li>
                ))}
              </ul>

              <h4>Where volunteers can help</h4>
              <ul className="egm-draft-help">
                {brief.help.map(item => (
                  <li key={item.id}>
                    <strong>{item.task}</strong> — Target review: {item.reviewDate}. ({item.successCriterion})
                  </li>
                ))}
              </ul>
            </article>

            <p className="egm-note">
              Public drafts exclude private research notes, PostHog dashboard usage, and internal Google information.
              A maintainer must review and post this draft manually.
            </p>
          </div>
        </DataComponent>
      )}
      {(
        <>
          {/* 1. Commitments */}
          <DataComponent
            id="weekly-brief-commitments"
            queryId={activeQueryId}
            title="1. Close last week's commitments"
            kind="custom"
            variant="card"
            displayRows={brief.commitments}
            sourceRowsByQuery={{ [activeQueryId]: sourceRows }}
          >
            <div data-reviewed-rows>
              <div className="egm-table-scroll">
                <table className="egm-brief-table">
                  <thead>
                    <tr>
                      <th>Commitment action</th>
                      <th>Owner</th>
                      <th>Evidence</th>
                      <th>Status</th>
                      <th>Next check</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brief.commitments.map(item => (
                      <tr key={item.id}>
                        <td>{item.action}</td>
                        <td>{item.owner}</td>
                        <td>
                          {safeExternalUrl(item.url) ? (
                            <a href={safeExternalUrl(item.url)} target="_blank" rel="noreferrer">
                              {item.evidence}
                            </a>
                          ) : (
                            item.evidence
                          )}
                        </td>
                        <td>{item.status}</td>
                        <td>{item.nextCheck}</td>
                        <td>
                          <span className={`egm-badge egm-outcome-${item.outcome}`}>
                            {item.outcome}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="egm-note">
                Close prior commitments before selecting new work. Resolved actions require verified evidence.
              </p>
            </div>
          </DataComponent>

          {/* 2. What improved */}
          <DataComponent
            id="weekly-brief-improved"
            queryId={activeQueryId}
            title="2. What improved"
            kind="custom"
            variant="card"
            displayRows={brief.improved}
            sourceRowsByQuery={{ [activeQueryId]: sourceRows }}
          >
            <div data-reviewed-rows>
              <div className="egm-stage-columns">
                {/* Stage: User-verified */}
                <div className="egm-stage-column" data-stage="user-verified">
                  <h4 className="egm-stage-header">
                    <span className="egm-brief-stage-badge stage-user-verified">User-verified</span>
                    <span className="egm-stage-count">({brief.improvedByStage.userVerified.length})</span>
                  </h4>
                  <p className="egm-stage-subhead">Confirmed by user report or community retest</p>
                  <ul className="egm-stage-list">
                    {brief.improvedByStage.userVerified.map(item => (
                      <li key={item.id} className="egm-stage-item">
                        <div className="egm-item-title">
                          {safeExternalUrl(item.url) ? (
                            <a href={safeExternalUrl(item.url)} target="_blank" rel="noreferrer">
                              {item.title}
                            </a>
                          ) : (
                            item.title
                          )}
                        </div>
                        <div className="egm-item-evidence">{item.evidence}</div>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Stage: Released */}
                <div className="egm-stage-column" data-stage="released">
                  <h4 className="egm-stage-header">
                    <span className="egm-brief-stage-badge stage-released">Released ({brief.latestRelease})</span>
                    <span className="egm-stage-count">({brief.improvedByStage.released.length})</span>
                  </h4>
                  <p className="egm-stage-subhead">Shipped in tagged release; user outcome unverified</p>
                  <ul className="egm-stage-list">
                    {brief.improvedByStage.released.map(item => (
                      <li key={item.id} className="egm-stage-item">
                        <div className="egm-item-title">
                          {safeExternalUrl(item.url) ? (
                            <a href={safeExternalUrl(item.url)} target="_blank" rel="noreferrer">
                              {item.title}
                            </a>
                          ) : (
                            item.title
                          )}
                        </div>
                        <div className="egm-item-evidence">{item.evidence}</div>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Stage: Merged-unreleased */}
                <div className="egm-stage-column" data-stage="merged-unreleased">
                  <h4 className="egm-stage-header">
                    <span className="egm-brief-stage-badge stage-merged-unreleased">Merged on main</span>
                    <span className="egm-stage-count">({brief.improvedByStage.mergedUnreleased.length})</span>
                  </h4>
                  <p className="egm-stage-subhead">PR merged to main; not yet cut into a tagged release</p>
                  <ul className="egm-stage-list">
                    {brief.improvedByStage.mergedUnreleased.map(item => (
                      <li key={item.id} className="egm-stage-item">
                        <div className="egm-item-title">
                          {safeExternalUrl(item.url) ? (
                            <a href={safeExternalUrl(item.url)} target="_blank" rel="noreferrer">
                              {item.title}
                            </a>
                          ) : (
                            item.title
                          )}
                        </div>
                        <div className="egm-item-evidence">{item.evidence}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="egm-note">
                Merged does not mean released or recovered for a user. Closed does not mean fixed.
              </p>
            </div>
          </DataComponent>

          {/* 3. What needs attention */}
          <DataComponent
            id="weekly-brief-attention"
            queryId={activeQueryId}
            title="3. What needs attention"
            kind="custom"
            variant="card"
            displayRows={brief.attention}
            sourceRowsByQuery={{ [activeQueryId]: sourceRows }}
          >
            <div data-reviewed-rows>
              <div className="egm-attention-grid">
                {brief.attention.map(item => (
                  <article key={item.id} className="egm-attention-card">
                    <div className="egm-attention-top">
                      <span className={`egm-severity-badge severity-${item.severity}`}>
                        {item.severity} severity
                      </span>
                      <span className="egm-reports-count">
                        {item.independentReports} independent {item.independentReports === 1 ? 'report' : 'reports'}
                        {' '}· {item.commentCount} comments
                      </span>
                    </div>
                    <h4 className="egm-attention-title">
                      {safeExternalUrl(item.url) ? (
                        <a href={safeExternalUrl(item.url)} target="_blank" rel="noreferrer">
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </h4>
                    <div className="egm-attention-meta">
                      <strong>Host / Version:</strong> {item.affectedHost} ({item.affectedVersion})
                    </div>
                    <div className="egm-attention-detail">
                      <strong>Contrary evidence:</strong> {item.contraryEvidence}
                    </div>
                    <div className="egm-attention-detail">
                      <strong>Uncertainty:</strong> {item.uncertainty}
                    </div>
                    {item.nextAction && (
                      <div className="egm-attention-action">
                        <strong>Next action:</strong> {item.nextAction}
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <p className="egm-note">
                Discussion volume and repeated comments by one person do not set priority.
                Severity depends on reproducible user friction and environment impact.
              </p>
            </div>
          </DataComponent>

          {/* 4. Where you can help */}
          <DataComponent
            id="weekly-brief-help"
            queryId={activeQueryId}
            title="4. Where you can help (bounded volunteer proposals)"
            kind="custom"
            variant="card"
            displayRows={brief.help}
            sourceRowsByQuery={{ [activeQueryId]: sourceRows }}
          >
            <div data-reviewed-rows>
              <div className="egm-help-grid">
                {brief.help.map((item, index) => (
                  <div key={item.id} className="egm-help-card">
                    <div className="egm-help-header">
                      <span className="egm-help-number">Request #{index + 1}</span>
                      <span className="egm-help-status">Proposal</span>
                    </div>
                    <h4 className="egm-help-task">
                      {safeExternalUrl(item.url) ? (
                        <a href={safeExternalUrl(item.url)} target="_blank" rel="noreferrer">
                          {item.task}
                        </a>
                      ) : (
                        item.task
                      )}
                    </h4>
                    <dl className="egm-help-meta">
                      <div>
                        <dt>Owner</dt>
                        <dd>{item.owner}</dd>
                      </div>
                      <div>
                        <dt>Success criterion</dt>
                        <dd>{item.successCriterion}</dd>
                      </div>
                      <div>
                        <dt>Review date</dt>
                        <dd>{item.reviewDate}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
              <p className="egm-note">
                At most three requests per week. Requests are proposals; volunteers are never assigned without agreement.
              </p>
            </div>
          </DataComponent>

          {/* 5. Missing evidence */}
          <DataComponent
            id="weekly-brief-missing-evidence"
            queryId={activeQueryId}
            title="5. Missing evidence"
            kind="custom"
            variant="card"
            displayRows={brief.missingEvidence}
            sourceRowsByQuery={{ [activeQueryId]: sourceRows }}
          >
            <div data-reviewed-rows>
              <ul className="egm-missing-evidence-list">
                {brief.missingEvidence.map(item => (
                  <li key={item.id} className="egm-missing-item">
                    <p className="egm-missing-question">
                      <strong>Unresolved question:</strong> {item.unresolvedQuestion}
                    </p>
                    <p className="egm-missing-observation">
                      <strong>Smallest observation:</strong> {item.smallestObservation}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="egm-note">
                Unavailable evidence is unknown, never zero.
              </p>
            </div>
          </DataComponent>
        </>
      )}
    </section>
  )
}

export function OssHealthSection({ queries = {} }) {
  const health = ossHealthViewModel(queries)
  const activeQueryId = queries.oss_health ? 'oss_health' : (queries.maintenance ? 'maintenance' : Object.keys(queries)[0] || 'oss_health')
  const sourceRows = queries[activeQueryId]?.rows ?? []

  return (
    <section id="oss-health" className="egm-oss-health-section">
      <DataComponent
        id="oss-health-metrics"
        queryId={activeQueryId}
        title="Open source project health"
        kind="custom"
        variant="card"
        displayRows={health.rows}
        sourceRowsByQuery={{ [activeQueryId]: sourceRows }}
      >
        <div className="egm-health-container" data-reviewed-rows>
          <div className="egm-health-grid">
            {health.rows.map(item => (
              <div key={item.metric} className="egm-health-card">
                <span className="egm-health-label">{item.label}</span>
                <span className={`egm-health-value ${item.value === null ? 'value-unmeasured' : ''}`}>
                  {item.displayValue}
                </span>
                <span className="egm-health-note">{item.note}</span>
              </div>
            ))}
          </div>
          <p className="egm-note">
            Do not rank individual contributors or equate PR count with impact. Recognize contributions beyond code.
            Turnaround intervals without telemetry remain unmeasured, not zero.
          </p>
        </div>
      </DataComponent>
    </section>
  )
}

export function WorkflowResearchSection({ queries = {} }) {
  const research = workflowResearchViewModel(queries)
  const activeQueryId = queries.workflow_research ? 'workflow_research' : (queries.traffic ? 'traffic' : Object.keys(queries)[0] || 'workflow_research')
  const sourceRows = queries[activeQueryId]?.rows ?? []

  return (
    <section id="workflow-research" className="egm-workflow-research-section">
      <DataComponent
        id="adoption-workflow-research"
        queryId={activeQueryId}
        title="Voluntary first-workflow and blocker-retest log"
        kind="custom"
        variant="card"
        displayRows={research.rows}
        sourceRowsByQuery={{ [activeQueryId]: sourceRows }}
      >
        <div className="egm-research-flow" data-reviewed-rows>
          <div className="egm-research-summary-bar">
            <div className="egm-summary-stat">
              <span className="stat-label">Public friction records</span>
              <span className="stat-value">
                {research.metrics.recordedWorkflowRows}
              </span>
            </div>
            <div className="egm-summary-stat">
              <span className="stat-label">Verified blocker retests</span>
              <span className="stat-value">{research.metrics.verifiedBlockerRetests}</span>
            </div>
            <div className="egm-summary-stat">
              <span className="stat-label">Pending blocker retests</span>
              <span className="stat-value">{research.metrics.pendingBlockerRetests}</span>
            </div>
            <div className="egm-summary-stat">
              <span className="stat-label">Repeat use recorded</span>
              <span className="stat-value stat-unmeasured">
                {research.metrics.repeatUseRecorded ?? 'Not measured'}
              </span>
            </div>
          </div>

          <div className="egm-table-scroll">
            <table className="egm-workflow-table">
              <thead>
                <tr>
                  <th>Intended task / Issue</th>
                  <th>Environment & version</th>
                  <th>Last successful step</th>
                  <th>Outcome & help required</th>
                  <th>Voluntary retest status</th>
                  <th>Repeat use inquiry</th>
                </tr>
              </thead>
              <tbody>
                {research.rows.map(row => (
                  <tr key={row.id}>
                    <td>{safeExternalUrl(row.url) ? <a href={safeExternalUrl(row.url)} target="_blank" rel="noreferrer">{row.intendedTask}</a> : row.intendedTask}</td>
                    <td>{row.environment} ({row.version})</td>
                    <td>{row.lastSuccessfulStep}</td>
                    <td>
                      <span className={`egm-badge outcome-${row.outcome}`}>{row.outcome}</span>
                      {row.helpRequired && (
                        <div className="egm-help-detail">{row.helpRequired}</div>
                      )}
                    </td>
                    <td>
                      <span className={`egm-badge retest-${row.voluntaryRetest}`}>
                        {row.retestDetail || row.voluntaryRetest}
                      </span>
                    </td>
                    <td>
                      <span className={`egm-badge repeat-${row.repeatUse}`}>
                        {row.repeatUse === 'unknown' ? 'Unknown' : row.repeatUse.replaceAll('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="egm-note">{research.caveat}</p>
          <p className="egm-note">
            Public issue follow-ups and retests only. Private research notes and participant identities are excluded from public summaries.
          </p>
        </div>
      </DataComponent>
    </section>
  )
}
