import React from 'react'
import {DataComponent} from '../../data-app-public.jsx'
import {overviewSummary} from './overview-summary.mjs'

export function OverviewSummary({queries}) {
  const summary=overviewSummary(queries)
  if(!summary)return null
  const sourceRowsByQuery=Object.fromEntries(summary.queryIds.map(id=>[id,queries[id]?.rows??[]]))
  return <DataComponent id="overview-summary" title="At a glance" queryId={summary.queryIds[0]} queryIds={summary.queryIds} kind="custom" variant="plain" showHeading={false} displayRows={summary.queryIds.flatMap(id=>queries[id]?.rows??[])} sourceRowsByQuery={sourceRowsByQuery}>
    <p className="egm-copy" data-reviewed-rows style={{margin:'0 0 20px',maxWidth:'100ch'}}>{summary.sentences.join(' ')}</p>
  </DataComponent>
}
