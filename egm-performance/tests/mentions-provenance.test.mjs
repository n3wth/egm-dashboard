import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createServer} from 'vite'
import {reviewedNarrativeQueries} from '../src/source-provenance.js'

test('HN-enriched mention display retains original reviewed source rows in summary',async()=>{
  const server=await createServer({server:{middlewareMode:true},logLevel:'silent'})
  try {
    const {mentionSummarySources}=await server.ssrLoadModule('/src/content/dashboard/Mentions.jsx')
    const snapshot=JSON.parse(await readFile(new URL('../src/data.json',import.meta.url),'utf8'))
    const queries={...snapshot.queries,mention_engagement:{rows:[{url:snapshot.queries.mentions.rows[0].url,hnPoints:2,comments:0}]}}
    const displayRows=queries.mentions.rows.map((row,index)=>index===0?{...row,hnPoints:2,comments:0}:row)
    const discovery={sourceRowsByQuery:{mention_engagement:queries.mention_engagement.rows}}
    const component={id:'mentions-summary',kind:'custom',queryId:'mentions',queryIds:['mentions','mentions_status','mention_engagement'],displayRows,sourceRowsByQuery:mentionSummarySources(queries,discovery)}
    assert.equal(component.sourceRowsByQuery.mentions,queries.mentions.rows)
    assert.doesNotThrow(()=>reviewedNarrativeQueries(component,queries))
    assert.throws(()=>reviewedNarrativeQueries({...component,sourceRowsByQuery:{...component.sourceRowsByQuery,mentions:displayRows}},queries),/non-reviewed rows/)
  }finally{await server.close()}
})
