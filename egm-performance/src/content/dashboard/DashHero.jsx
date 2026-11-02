import React from 'react'
import {DataComponent, Section} from '../../data-app-public.jsx'
import {trafficCoverageNote} from './overview-summary.mjs'

export function DashHero({id, title, summary, queries, headingId}) {
  if (!summary) return <Section title={title} id={headingId} className="egm-dash-hero" spacing="none"/>
  const queryIds=[...new Set([...summary.queryIds,...(summary.range&&queries.traffic?['traffic']:[])])]
  const coverage=summary.range?trafficCoverageNote(queries):null
  const sourceRowsByQuery = Object.fromEntries(queryIds.map(queryId => [queryId, queries[queryId]?.rows ?? []]))
  return <DataComponent id={id} title={title} className="egm-dash-hero" queryId={queryIds[0]} queryIds={queryIds} kind="custom" variant="plain" displayRows={queryIds.flatMap(queryId => queries[queryId]?.rows ?? [])} sourceRowsByQuery={sourceRowsByQuery}>
    <p className="egm-dash-hero-headline">{summary.headline}</p>
    {summary.facts.length ? <ul className="egm-dash-hero-facts">{summary.facts.map(fact => <li key={fact}>{fact}</li>)}</ul> : null}
    {summary.range && <p className="egm-dash-hero-range">Reporting period: <time>{summary.range.label}</time><span className="egm-dash-hero-note">{summary.range.note}</span></p>}
    {coverage&&<p className="egm-dash-hero-range">{coverage}</p>}
  </DataComponent>
}
