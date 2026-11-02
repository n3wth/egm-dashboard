import React from 'react'
import {DataComponent, Section} from '../../data-app-public.jsx'
import {AnalysisLabel} from './SavedAnalysis.jsx'

export function DashHero({id, title, summary, queries, headingId}) {
  if (!summary) return <Section title={title} id={headingId} className="egm-dash-hero" spacing="none"/>
  const queryIds=[...new Set([...summary.queryIds,...(!summary.analysis&&summary.range&&queries.traffic?['traffic']:[])])]
  const sourceRowsByQuery = Object.fromEntries(queryIds.map(queryId => [queryId, queries[queryId]?.rows ?? []]))
  return <DataComponent id={id} title={title} className="egm-dash-hero" queryId={queryIds[0]} queryIds={queryIds} kind="custom" variant="plain" displayRows={queryIds.flatMap(queryId => queries[queryId]?.rows ?? [])} sourceRowsByQuery={sourceRowsByQuery}>
    <p className="egm-dash-hero-headline">{summary.headline}</p>
    {summary.facts.length ? <ul className="egm-dash-hero-facts">{summary.facts.map(fact => <li key={fact}>{fact}</li>)}</ul> : null}
    <AnalysisLabel analysis={summary.analysis}/>
    <a className="egm-summary-notes-link" href="#page-notes">Notes and reporting period</a>
  </DataComponent>
}
