import React from 'react'
import {DataComponent,Section} from '../../data-app-public.jsx'
import {overviewSummary} from './overview-summary.mjs'

export function OverviewSummary({queries}) {
  const summary=overviewSummary(queries)
  if(!summary)return <Section title="Overview" id="overview-heading" className="egm-overview-heading" spacing="none"/>
  const sourceRowsByQuery=Object.fromEntries(summary.queryIds.map(id=>[id,queries[id]?.rows??[]]))
  return <DataComponent id="overview-summary" title="Overview" className="egm-overview-heading" queryId={summary.queryIds[0]} queryIds={summary.queryIds} kind="custom" variant="plain" displayRows={summary.queryIds.flatMap(id=>queries[id]?.rows??[])} sourceRowsByQuery={sourceRowsByQuery}>
    <p className="egm-copy" data-reviewed-rows style={{margin:0,maxWidth:'100ch'}}>{summary.sentences.join(' ').split(/(\b\d[\d,]*(?:\.\d+)?%?)/g).map((part,index)=>/^\d/.test(part)?<strong key={index}>{part}</strong>:part)}</p>
  </DataComponent>
}
