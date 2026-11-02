import React from 'react'
import {Icon} from '../../data-app-public.jsx'
import {CollectionStatus} from './CollectionStatus.jsx'
import {AnalysisLabel} from './SavedAnalysis.jsx'

export function SiteFooter({generatedAt,refreshStatus,summary}) {
  const timestamp=Date.parse(generatedAt)
  const updated=Number.isFinite(timestamp)?new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(timestamp)):null
  return <footer className="egm-site-footer">
    <div className="egm-footer-meta">{updated&&<span>Updated <time dateTime={generatedAt}>{updated}</time></span>}<CollectionStatus refreshStatus={refreshStatus}/></div>
    <nav aria-label="Project links"><a href="https://egm.dev" target="_blank" rel="noreferrer">egm.dev <Icon name="arrowUpRight" size={12}/></a><a href="https://github.com/google/elephant-goldfish-model" target="_blank" rel="noreferrer">GitHub <Icon name="arrowUpRight" size={12}/></a><a href="#data-app-main">Back to top <Icon name="arrowUp" size={12}/></a></nav>
    {summary&&<div className="egm-hero-context">
      <details className="egm-hero-method">
        <summary>{summary.analysis ? summary.analysis.stale ? 'Saved analysis · earlier observations' : 'Saved analysis' : 'Calculated from source data'}</summary>
        <AnalysisLabel analysis={summary.analysis}/>
        {summary.analysis?.unknowns.length>0&&<p className="egm-note">Unknown: {summary.analysis.unknowns.join(' ')}</p>}
      </details>
      <a className="egm-summary-notes-link" href="#page-notes">Notes and reporting period</a>
    </div>}
  </footer>
}
