import React from 'react'
import {DataComponent} from '../../data-app-public.jsx'
import {savedAnalysis} from './saved-analysis.mjs'
import './saved-analysis.css'

export function AnalysisLabel({analysis}) {
  return <p className="egm-note">{analysis?<>Saved Gemini analysis · <time dateTime={analysis.generatedAt}>{analysis.generatedLabel}</time>{analysis.stale?' · Based on earlier observations':''}</>:'Daily analysis unavailable. Showing a calculated fallback.'}</p>
}

export function AnalysisText({analysis}) {
  return <div className="egm-saved-analysis"><AnalysisLabel analysis={analysis}/><p>{analysis.summary}</p><p>Proposed next step: {analysis.nextStep}</p>{analysis.unknowns.length>0&&<p className="egm-note">Unknown: {analysis.unknowns.join(' ')}</p>}</div>
}

export function SavedAnalysis({id,queries,fallback}) {
  const analysis=savedAnalysis(queries,id)
  if(!analysis)return <><AnalysisLabel/>{fallback}</>
  const queryIds=['daily_analysis',...analysis.evidenceQueryIds]
  return <DataComponent id={`saved-analysis-${id.replaceAll('_','-')}`} title="Daily interpretation" queryId="daily_analysis" queryIds={queryIds} sourceRowsByQuery={Object.fromEntries(queryIds.map(queryId=>[queryId,queries[queryId]?.rows??[]]))} displayRows={[analysis]} kind="custom" variant="card">
    <h3>{analysis.headline}</h3>
    <AnalysisText analysis={analysis}/>
  </DataComponent>
}
