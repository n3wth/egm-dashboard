import React from 'react'
import {DataComponent,Section} from '../../data-app-public.jsx'
import {pageSummary} from './page-summary.mjs'
const titles={acquisition:'Acquisition',adoption:'Adoption',website:'Website',development:'Development',research:'Research',mentions:'Mentions'}
export function PageSummary({page,queries}) {
  const summary=pageSummary(page,queries)
  const title=titles[page]??page
  if(!summary)return <Section title={title} id={`${page}-summary-heading`} className="egm-overview-heading" spacing="none"/>
  const sourceRowsByQuery=Object.fromEntries(summary.queryIds.map(id=>[id,queries[id]?.rows??[]]))
  return <DataComponent id={`${page}-summary`} title={title} className="egm-overview-heading" queryId={summary.queryIds[0]} queryIds={summary.queryIds} kind="custom" variant="plain" displayRows={summary.queryIds.flatMap(id=>queries[id]?.rows??[])} sourceRowsByQuery={sourceRowsByQuery}>
    <p className="egm-copy" data-reviewed-rows style={{margin:0,maxWidth:'100ch'}}>{summary.sentences.join(' ').split(/(\b\d[\d,]*(?:\.\d+)?%?)/g).map((part,index)=>/^\d/.test(part)?<strong key={index}>{part}</strong>:part)}</p>
  </DataComponent>
}
