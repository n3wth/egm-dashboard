import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'

const sourceCases=[
  ['peers','research-peer-table','2026-11-01T08:30:00Z','Nov 1, 2026, 1:30 AM PDT'],
  ['research_evidence','research-discussion-evidence','2026-11-01T09:30:00Z','Nov 1, 2026, 1:30 AM PST'],
  ['exa_research','research-candidate-table','2026-11-02T07:00:00Z','Nov 1, 2026, 11:00 PM PST'],
  ['seo_backlinks','research-seo-backlinks','2026-11-02T09:00:00Z','Nov 2, 2026, 1:00 AM PST'],
  ['seo_referring_domains','research-seo-referring-domains','2026-11-02T10:00:00Z','Nov 2, 2026, 2:00 AM PST'],
  ['seo_top_backlinks','research-seo-top-backlinks','2026-11-02T11:00:00Z','Nov 2, 2026, 3:00 AM PST'],
  ['seo_overview','research-seo-overview','2026-11-02T12:00:00Z','Nov 2, 2026, 4:00 AM PST'],
  ['seo_keywords','research-seo-keywords','2026-11-02T13:00:00Z','Nov 2, 2026, 5:00 AM PST'],
  ['seo_competitors','research-seo-competitors','2026-11-02T14:00:00Z','Nov 2, 2026, 6:00 AM PST'],
  ['emerging','research-emerging-table','2026-11-02T15:00:00Z','Nov 2, 2026, 7:00 AM PST']
]

const card=(html,id)=>{
  const result=html.match(new RegExp(`data-component-id="${id}"[\\s\\S]*?<\\/section>`))?.[0]
  assert.ok(result,`${id} is rendered`)
  return result
}

test('Research shows each source collection time rather than the overall snapshot time',async()=>{
  const server=await createServer({server:{middlewareMode:true},logLevel:'silent'})
  try {
    const {DataAppShell}=await server.ssrLoadModule('/src/DataAppShell.jsx')
    const {Research}=await server.ssrLoadModule('/src/content/dashboard/Research.jsx')
    const snapshot=JSON.parse(readFileSync('src/data.json','utf8'))
    snapshot.generatedAt='2026-11-03T20:00:00Z'
    const reportRows={
      seo_backlinks:[{total:3,domains_num:2}],
      seo_referring_domains:[{domain:'source.example.org',backlinks_num:2}],
      seo_top_backlinks:[{source_url:'https://source.example.org/article',source_title:'Article',anchor:'EGM'}],
      seo_overview:[{domain:'egm.dev',organic_traffic:4}],
      seo_keywords:[{keyword:'elephant goldfish model',position:2}],
      seo_competitors:[{domain:'peer.example.org',common_keywords:1}]
    }
    for(const [id,rows] of Object.entries(reportRows))snapshot.queries[id]={rows,source:{label:'Fixture report'}}
    for(const [id,,executedAt] of sourceCases)snapshot.queries[id].source={...snapshot.queries[id].source,executedAt}
    const render=()=>renderToStaticMarkup(React.createElement(DataAppShell,{snapshot,hosted:false,persistLocally:false},React.createElement(Research)))
    const before=structuredClone(snapshot)
    const html=render()
    for(const [,id,executedAt,label] of sourceCases) {
      const body=card(html,id)
      assert.match(body,/Collected <time /)
      assert.ok(body.includes(label),`${id} shows its own Pacific collection timestamp`)
      assert.match(body,new RegExp(`<time datetime="${executedAt}">`,'i'))
      assert.doesNotMatch(body,/Nov 3, 2026, 12:00 PM PST/)
    }
    assert.deepEqual(snapshot,before)

    for(const value of [null,undefined,'','not a timestamp']) {
      for(const [id] of sourceCases)snapshot.queries[id].source.executedAt=value
      const unknown=render()
      for(const [,id] of sourceCases) {
        const body=card(unknown,id)
        assert.match(body,/Collection time unavailable/)
        assert.doesNotMatch(body,/Collected <time|1970|Nov 3, 2026, 12:00 PM PST/)
      }
    }
  } finally {await server.close()}
})
