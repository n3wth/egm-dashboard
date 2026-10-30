import React from 'react'
import {DataComponent, Section} from '../../data-app-public.jsx'

export function DashHero({id, title, summary, queries, headingId}) {
  if (!summary) return <Section title={title} id={headingId} className="egm-dash-hero" spacing="none"/>
  const sourceRowsByQuery = Object.fromEntries(summary.queryIds.map(queryId => [queryId, queries[queryId]?.rows ?? []]))
  return <DataComponent id={id} title={title} className="egm-dash-hero" queryId={summary.queryIds[0]} queryIds={summary.queryIds} kind="custom" variant="plain" displayRows={summary.queryIds.flatMap(queryId => queries[queryId]?.rows ?? [])} sourceRowsByQuery={sourceRowsByQuery} headerControls={summary.range ? <p className="egm-dash-hero-range"><time>{summary.range.label}</time><span className="egm-dash-hero-note">{summary.range.note}</span></p> : null}>
    <p className="egm-dash-hero-headline">{summary.headline}</p>
    {summary.facts.length ? <ul className="egm-dash-hero-facts">{summary.facts.map(fact => <li key={fact}>{fact}</li>)}</ul> : null}
  </DataComponent>
}
