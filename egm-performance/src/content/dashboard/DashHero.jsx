import React from 'react'
import {DataComponent, Section} from '../../data-app-public.jsx'

const nextSteps = {
  Overview: 'Compare daily star gains with referral activity before choosing the next growth experiment.',
  Acquisition: 'Identify the channels sending repo traffic, then test one channel at a time. Unattributed traffic remains unknown.',
  Adoption: 'Observe five new users completing the first workflow. Record blockers and check whether they return after seven days.',
  Website: 'Review the referral contribution and page experience before testing a change to the path from egm.dev to GitHub.',
  Development: 'Review open issues for first-use blockers. Discussion volume alone does not establish priority.',
  Research: 'Read the verified source evidence before choosing an experiment. Indexed leads still need checking.',
  Mentions: 'Review the coverage and sampled comments for questions to investigate. Views alone do not establish adoption.'
}

export function DashHero({id, title, summary, queries, headingId}) {
  if (!summary) return <Section title={title} id={headingId} className="egm-dash-hero" spacing="none"/>
  const queryIds=[...new Set([...summary.queryIds,...(!summary.analysis&&summary.range&&queries.traffic?['traffic']:[])])]
  const sourceRowsByQuery = Object.fromEntries(queryIds.map(queryId => [queryId, queries[queryId]?.rows ?? []]))
  return <DataComponent id={id} title={title} className="egm-dash-hero" queryId={queryIds[0]} queryIds={queryIds} kind="custom" variant="plain" displayRows={queryIds.flatMap(queryId => queries[queryId]?.rows ?? [])} sourceRowsByQuery={sourceRowsByQuery}>
    <div className="egm-hero-body">
      <div className="egm-hero-reading" data-reviewed-rows>
        <p className="egm-dash-hero-headline">{summary.headline}</p>
        {summary.facts.length ? <ul className="egm-dash-hero-facts">{summary.facts.map(fact => <li key={fact}>{fact}</li>)}</ul> : null}
      </div>
      <aside className="egm-hero-next" aria-label="Suggested next step">
        <h3>What to do next</h3>
        <p>{summary.analysis?.nextStep || nextSteps[title]}</p>
      </aside>
    </div>
    {summary.analysis&&<p className="egm-hero-analysis-note">{summary.analysis.stale?'Based on earlier observations':'Saved Gemini analysis'}</p>}
  </DataComponent>
}
