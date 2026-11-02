import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {readFileSync} from 'node:fs'
import {createServer} from 'vite'

test('every page pairs its evidence with a next step and retains source provenance',async()=>{
  const server=await createServer({server:{middlewareMode:true},logLevel:'silent'})
  try {
    const {DataAppShell}=await server.ssrLoadModule('/src/DataAppShell.jsx')
    const {OverviewSummary}=await server.ssrLoadModule('/src/content/dashboard/OverviewSummary.jsx')
    const {PageSummary}=await server.ssrLoadModule('/src/content/dashboard/PageSummary.jsx')
    const {SiteFooter}=await server.ssrLoadModule('/src/content/dashboard/PageFooter.jsx')
    const {pageSummary}=await server.ssrLoadModule('/src/content/dashboard/page-summary.mjs')
    const {overviewSummary}=await server.ssrLoadModule('/src/content/dashboard/overview-summary.mjs')
    const snapshot=JSON.parse(readFileSync('src/data.json','utf8'))
    delete snapshot.queries.daily_analysis
    const before=structuredClone(snapshot)
    for(const page of ['overview','acquisition','adoption','website','development','research','mentions']) {
      const component=page==='overview'?OverviewSummary:PageSummary
      const html=renderToStaticMarkup(React.createElement(DataAppShell,{snapshot,hosted:false,persistLocally:false},React.createElement(component,{page,queries:snapshot.queries})))
      assert.match(html,/aria-label="Suggested next step"/,page)
      assert.match(html,/What to do next/,page)
      assert.doesNotMatch(html,/Calculated from source data|Daily analysis unavailable|href="#page-notes"/,page)
      assert.match(html,/data-query-id=/,page)
      const summary=page==='overview'?overviewSummary(snapshot.queries):pageSummary(page,snapshot.queries)
      const footer=renderToStaticMarkup(React.createElement(SiteFooter,{summary,generatedAt:snapshot.generatedAt}))
      assert.match(footer,/Calculated from source data/,page)
      assert.match(footer,/Daily analysis unavailable/,page)
      assert.match(footer,/href="#page-notes"/,page)
    }
    assert.deepEqual(snapshot,before)
  } finally {await server.close()}
})
