import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'

const observationRows=Array.from({length:16},(_,index)=>{
  const observedAt=new Date(Date.UTC(2026,9,15+index,19,30)).toISOString()
  return {date:observedAt.slice(0,10),observedAt,stars:index===15?10000:index<=7?1000+index*10:1070-(index-7)*5}
})

test('observed star fallback and Adoption present the supported measurements',async t=>{
  const server=await createServer({server:{middlewareMode:true},logLevel:'silent'})
  try {
    const {DataAppShell}=await server.ssrLoadModule('/src/DataAppShell.jsx')
    const {DashboardContent,StarGrowth}=await server.ssrLoadModule('/src/content/dashboard/DashboardContent.jsx')
    const {OverviewSummary}=await server.ssrLoadModule('/src/content/dashboard/OverviewSummary.jsx')
    const makeSnapshot=()=>{
      const snapshot=JSON.parse(readFileSync('src/data.json','utf8'))
      snapshot.generatedAt=observationRows.at(-1).observedAt
      snapshot.queries.star_history.source.caveats=['Star history is stale: full reconstruction was skipped.']
      snapshot.queries.star_observations={rows:structuredClone(observationRows),source:{label:'Actual GitHub repository total observations',executedAt:snapshot.generatedAt}}
      snapshot.queries.reach.rows[0].stars=10000
      return snapshot
    }
    const render=(snapshot,element,props={})=>renderToStaticMarkup(React.createElement(DataAppShell,{snapshot,hosted:false,persistLocally:false,...props},element))

    await t.test('stale reconstruction defaults to observed net change and excludes the partial sample from comparison',()=>{
      const snapshot=makeSnapshot()
      const before=structuredClone(snapshot)
      const html=render(snapshot,React.createElement(StarGrowth,{rows:snapshot.queries.star_history.rows,observedAt:snapshot.queries.star_history.source.executedAt,stale:true,observations:snapshot.queries.star_observations}))
      assert.match(html,/data-query-id="star_observations"/)
      assert.match(html,/Observed net star change/)
      assert.match(html,/-35 net stars across the latest seven daily-snapshot intervals, versus 70 in the preceding seven/)
      assert.match(html,/Actual bounds:/)
      assert.match(html,/Oct 15, 2026, 12:30 PM PDT/)
      assert.match(html,/Net change can be negative/)
      assert.match(html,/partial sampling date/)
      assert.doesNotMatch(html,/Star history is out of date|140 new stars/)
      assert.deepEqual(snapshot,before)
    })

    await t.test('sparse observations preserve the daily reconstruction and its stale warning',()=>{
      const snapshot=makeSnapshot()
      snapshot.queries.star_observations.rows=[observationRows[0],observationRows.at(-1)]
      const html=render(snapshot,React.createElement(StarGrowth,{rows:snapshot.queries.star_history.rows,observedAt:snapshot.queries.star_history.source.executedAt,stale:true,observations:snapshot.queries.star_observations}))
      assert.match(html,/Daily new stars/)
      assert.match(html,/Star history is out of date/)
      assert.match(html,/Observed totals/)
      assert.doesNotMatch(html,/Observed star totals/)
    })

    await t.test('one observed sample displays a total and cannot advertise a net-change comparison',()=>{
      const snapshot=makeSnapshot()
      snapshot.queries.star_observations.rows=snapshot.queries.star_observations.rows.slice(-1)
      const html=render(snapshot,React.createElement(StarGrowth,{rows:[],observedAt:snapshot.generatedAt,stale:true,observations:snapshot.queries.star_observations}))
      assert.match(html,/Observed star totals/)
      const netButton=html.match(/<button\b(?:(?!<\/button>)[\s\S])*?Net change(?:(?!<\/button>)[\s\S])*?<\/button>/)?.[0]
      assert.ok(netButton)
      assert.match(netButton,/disabled=""/)
      assert.match(html,/Comparison needs 15 consecutive closed sampling dates/)
      assert.doesNotMatch(html,/Observed net star change|net stars across the latest/)
    })

    await t.test('Overview identifies observed weekly change and keeps the actual observation query as evidence',()=>{
      const snapshot=makeSnapshot()
      const html=render(snapshot,React.createElement(OverviewSummary,{queries:snapshot.queries}))
      assert.match(html,/The latest sampled week lost stars/)
      assert.match(html,/-35 net stars vs 70 across the prior seven sampling intervals/)
      assert.deepEqual(new Set(html.match(/data-query-ids="([^"]+)"/)?.[1].split(' ')),new Set(['reach','star_observations','traffic','referrers']))
      assert.match(html,/Notes and reporting period/)
      assert.doesNotMatch(html,/weekly star momentum is unavailable|new stars Oct/)
    })

    await t.test('short observed history names sample-to-sample bounds instead of inventing a week',()=>{
      const snapshot=makeSnapshot()
      snapshot.queries.star_observations.rows=[observationRows[0],observationRows[2]]
      const html=render(snapshot,React.createElement(OverviewSummary,{queries:snapshot.queries}))
      assert.match(html,/Star totals rose between observations/)
      assert.match(html,/20 net stars · samples dated Oct 15–Oct 17/)
      assert.deepEqual(new Set(html.match(/data-query-ids="([^"]+)"/)?.[1].split(' ')),new Set(['reach','star_observations','traffic','referrers']))
      assert.doesNotMatch(html,/latest seven daily-snapshot intervals|the prior week/)
    })

    await t.test('Adoption separates measurement gaps from package downloads without mutating reviewed assets',()=>{
      const snapshot=makeSnapshot()
      const downloads=[
        {release:'v1.0.0',asset:'egm-claude-1.0.0.zip',downloads:12},
        {release:'v1.0.0',asset:'egm-openai-1.0.0.zip',downloads:0},
        {release:'v1.0.0',asset:'egm-openai-1.0.1.zip',downloads:null},
        {release:'v1.0.0',asset:'SHA256SUMS',downloads:999},
        {release:'v1.0.0',asset:'release-notes.txt',downloads:321}
      ]
      snapshot.queries.downloads.rows=structuredClone(downloads)
      const before=structuredClone(snapshot)
      const html=render(snapshot,React.createElement(DashboardContent),{hosted:true,initialPresentation:{tabs:[{id:'adoption',label:'Adoption'}]}})
      const downloadCard=html.match(/data-component-id="adoption-release-downloads"[\s\S]*?<\/section>/)?.[0]
      assert.ok(downloadCard,'the Adoption runtime package table is rendered')
      assert.match(downloadCard,/Runtime package downloads/)
      assert.match(downloadCard,/egm-claude-1\.0\.0\.zip/)
      assert.match(downloadCard,/egm-openai-1\.0\.0\.zip/)
      assert.match(downloadCard,/egm-openai-1\.0\.1\.zip/)
      const unknownCountRow=downloadCard.match(/<tr\b(?:(?!<\/tr>)[\s\S])*?egm-openai-1\.0\.1\.zip(?:(?!<\/tr>)[\s\S])*?<\/tr>/)?.[0]
      const zeroCountRow=downloadCard.match(/<tr\b(?:(?!<\/tr>)[\s\S])*?egm-openai-1\.0\.0\.zip(?:(?!<\/tr>)[\s\S])*?<\/tr>/)?.[0]
      assert.match(unknownCountRow,/>—</)
      assert.match(zeroCountRow,/>0</)
      assert.doesNotMatch(downloadCard,/SHA256SUMS|release-notes\.txt|999|321/)
      assert.match(downloadCard,/Lifetime release-package downloads, not installs or successful runs/)
      assert.match(downloadCard,/Checksum files remain in the source data/)
      assert.match(html,/First successful workflow<\/dt><dd>Not measured/)
      assert.match(html,/Repeat use after seven days<\/dt><dd>Not measured/)
      assert.ok(html.indexOf('First use and repeat use')<html.indexOf('Runtime package downloads'))
      assert.doesNotMatch(html,/an even spread over/)
      assert.deepEqual(snapshot,before)
      assert.deepEqual(snapshot.queries.downloads.rows,downloads)
    })
  } finally {await server.close()}
})
