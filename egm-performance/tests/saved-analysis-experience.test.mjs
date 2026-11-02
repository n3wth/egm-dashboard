import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'

test('saved interpretation uses original evidence and distinguishes computed fallback and stale results',async()=>{
  const server=await createServer({server:{middlewareMode:true},logLevel:'silent'})
  try {
    const {DataAppShell}=await server.ssrLoadModule('/src/DataAppShell.jsx')
    const {OverviewSummary}=await server.ssrLoadModule('/src/content/dashboard/OverviewSummary.jsx')
    const {SavedAnalysis}=await server.ssrLoadModule('/src/content/dashboard/SavedAnalysis.jsx')
    const snapshot=JSON.parse(readFileSync('src/data.json','utf8'))
    const render=element=>renderToStaticMarkup(React.createElement(DataAppShell,{snapshot,hosted:false,persistLocally:false},element))
    const fallback=render(React.createElement(OverviewSummary,{queries:snapshot.queries}))
    assert.match(fallback,/Daily analysis unavailable. Showing a calculated fallback/)
    assert.doesNotMatch(fallback,/Saved Gemini analysis/)
    const observedAt=snapshot.queries.reach.source.executedAt,generatedAt=new Date(Date.now()-60000).toISOString()
    const section={id:'overview',headline:'Attention does not establish activation.',summary:'First successful use needs direct observation.',nextStep:'Observe a new user following the existing first workflow.',queryIds:['reach'],unknowns:['Repeat use remains unmeasured.'],confidence:'low'}
    snapshot.queries.daily_analysis={rows:[section,{...section,id:'research_opportunities'}],source:{executedAt:generatedAt,model:'gemini-flash-lite-latest',inputFingerprint:'original',inputSources:[{queryId:'reach',observedAt}]}}
    snapshot.queries.daily_analysis_input_reach={rows:structuredClone(snapshot.queries.reach.rows),source:{...snapshot.queries.reach.source,label:'Original analysis input · GitHub'}}
    const saved=render(React.createElement(OverviewSummary,{queries:snapshot.queries}))
    assert.match(saved,/Attention does not establish activation/)
    assert.match(saved,/Saved Gemini analysis/)
    assert.match(saved,/data-query-ids="daily_analysis daily_analysis_input_reach"/)
    assert.doesNotMatch(saved,/Showing a calculated fallback|Based on earlier observations/)
    const opportunity=render(React.createElement(SavedAnalysis,{id:'research_opportunities',queries:snapshot.queries,fallback:React.createElement('p',null,'Calculated proposal')}))
    assert.match(opportunity,/Proposed next step: /)
    assert.match(opportunity,/Unknown: Repeat use remains unmeasured/)
    assert.doesNotMatch(opportunity,/Calculated proposal/)
    snapshot.queries.daily_analysis_status={rows:[{status:'cached',inputFingerprint:'updated-without-a-new-source-timestamp'}]}
    const stale=render(React.createElement(OverviewSummary,{queries:snapshot.queries}))
    assert.match(stale,/Based on earlier observations/)
    assert.match(stale,/Attention does not establish activation/,'a stale label does not discard the last valid interpretation')
  } finally {await server.close()}
})
