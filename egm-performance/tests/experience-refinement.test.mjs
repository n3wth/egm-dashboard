import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import {readFileSync} from 'node:fs'
import {pageSummary} from '../src/content/dashboard/page-summary.mjs'

test('research and lifetime mentions do not inherit the traffic period',()=>{
  const queries={traffic:{rows:[{date:'2026-10-20'},{date:'2026-10-27'}]},research_evidence:{rows:[{status:'verified'}]},youtube_videos:{rows:[{views:5}]}}
  assert.equal(pageSummary('research',queries).range,null)
  assert.equal(pageSummary('mentions',queries).range,null)
})

test('onboarding stays available without covering the opening metrics; stopped traces are not completed',async()=>{
  const server=await createServer({server:{middlewareMode:true},logLevel:'silent'})
  try {
    const {Welcome}=await server.ssrLoadModule('/src/content/dashboard/Welcome.jsx')
    const {Trace}=await server.ssrLoadModule('/src/content/dashboard/AskPanel.jsx')
    const {StarGrowth}=await server.ssrLoadModule('/src/content/dashboard/DashboardContent.jsx')
    const {DataAppShell}=await server.ssrLoadModule('/src/DataAppShell.jsx')
    const snapshot=JSON.parse(readFileSync('src/data.json','utf8'))
    const render=element=>renderToStaticMarkup(React.createElement(DataAppShell,{snapshot,hosted:false,persistLocally:false},element))
    const welcome=render(React.createElement(Welcome))
    assert.match(welcome,/<details class="egm-welcome">/)
    assert.match(welcome,/<summary>How to read this dashboard<\/summary>/)
    const steps=[{id:'1',label:'Reading data',status:'active'}]
    for(const outcome of ['stopped','interrupted']) {
      const markup=renderToStaticMarkup(React.createElement(Trace,{steps,running:false,outcome}))
      assert.match(markup,outcome==='stopped'?/Stopped/:/Interrupted/)
      assert.doesNotMatch(markup,/Done in/)
    }
    assert.match(renderToStaticMarkup(React.createElement(Trace,{steps,running:false})),/Done in 1 step/)
    const stale=render(React.createElement(StarGrowth,{rows:[],observedAt:'2026-11-02T07:00:00Z',stale:true}))
    assert.match(stale,/Star history is out of date/)
    assert.match(stale,/Nov 1, 2026, 11:00 PM PST/)
  } finally {await server.close()}
})
