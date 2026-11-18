import test from 'node:test'
import assert from 'node:assert/strict'
import {handleAsk,askContext} from './ask.mjs'
import {analysisResult,isAnalysisQuestion} from './ask-analysis.mjs'
import {ANALYSIS_QUESTION} from '../egm-performance/src/content/dashboard/ask-analysis.mjs'

const origin='https://egm.n3wth.com'
const user={id:'owner',status:'approved'}
const now=Date.parse('2026-10-28T19:00:00Z')
const day=(start,offset)=>new Date(Date.parse(start+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10)
// 60 retained days ending 2026-10-27, with boundary totals 100, 170 and 205 on the compared window.
const starRows=Array.from({length:60},(_,i)=>{
  const date=day('2026-08-29',i),k=i-45
  return {date,stars:k<=0?55+i:k<=7?100+k*10:170+(k-7)*5,observedAt:date+'T20:00:00Z',secret:'token'}
})
const observations={rows:starRows,source:{label:'GitHub · observed repository star totals',executedAt:'2026-10-28T18:00:00Z',coverage:{startDate:'2026-08-29',endDate:'2026-10-27'},metricDefinitions:[{label:'Observed net star change',definition:'Stored definition.'}]}}
const baseSnapshot={generatedAt:'2026-10-28T18:05:00Z',queries:{star_observations:observations,traffic:{rows:[{views:100}],source:{label:'GitHub traffic',executedAt:'2026-10-27T00:00:00Z'}}}}
const request=(body,init={})=>new Request(origin+'/api/ask',{method:'POST',headers:{origin,'content-type':'application/json',...init.headers},body:JSON.stringify(body),...(init.signal?{signal:init.signal}:{})})

function environment({snapshot=baseSnapshot,changes=1,stored=true,infer}={}) {
  const sql=[]
  const env={APP_URL:origin,DB:{prepare(text){sql.push(text);return {bind(){return this},async first(){return stored?{body:JSON.stringify(snapshot),generated_at:snapshot.generatedAt}:null},async run(){assert.match(text,/^INSERT INTO audit/);return {meta:{changes}}}}}}}
  if(infer)env.INFER=infer
  return {env,sql}
}
const noNetwork={request:()=>assert.fail('no live GitHub call'),fetcher:()=>assert.fail('no analytics call'),waitUntil:()=>assert.fail('no deferred analytics')}
const ask=(body,env,options={})=>handleAsk(request(body),env,user,{now,...noNetwork,...options})
async function lines(response) {
  const text=await response.text()
  return text.split('\n').filter(Boolean).map(line=>JSON.parse(line))
}
function deepFreeze(value) {
  if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value)}
  return value
}

test('recognizes only the normalized starter question',()=>{
  for(const value of [ANALYSIS_QUESTION,ANALYSIS_QUESTION.slice(0,-1),'  compare egm NET star growth over the last 7 complete   sampling days with the previous 7 ? ',ANALYSIS_QUESTION.toUpperCase()])assert.equal(isAnalysisQuestion(value),true,value)
  for(const value of [
    'Compare EGM net star growth over the last 14 complete sampling days with the previous 14?',
    'Compare EGM net fork growth over the last 7 complete sampling days with the previous 7?',
    'Compare EGM net star growth over the last 7 complete sampling days with the previous 7??',
    'Compare EGM net star growth over the last 7 complete sampling days with the previous 7 for peers?',
    'Why?','And the previous 7?','How has EGM star growth changed?','',null,undefined,7,{question:ANALYSIS_QUESTION}
  ])assert.equal(isAnalysisQuestion(value),false,String(value))
})

test('complete result assembles answer, chart card, source and calculation from one computation',()=>{
  const result=analysisResult(baseSnapshot,now)
  const {calculation}=result
  assert.equal(calculation.status,'complete')
  assert.deepEqual([calculation.previous,calculation.current,calculation.difference],[70,35,-35])
  assert.equal(result.answer,"EGM's observed net star change was 35 stars over the latest 7 closed sampling intervals, compared with 70 stars over the previous 7, a signed difference of -35 stars [1].")
  assert.ok(!/%|percent/i.test(result.answer+result.coverageNote))
  assert.match(result.coverageNote,/not an exact midnight-to-midnight day/)
  assert.match(result.coverageNote,/reconstructed new stars/)
  assert.deepEqual(result.cards,[{type:'chart',calculated:true,queryId:'star_observations',title:'Observed net star change',sourceId:'1',observedAt:'2026-10-28T18:00:00.000Z',xKey:'date',series:['netStars'],seriesLabels:{netStars:'Net stars'},rows:result.cards[0].rows,rowCount:14,rowsTruncated:false,tab:'/overview',tabLabel:'Overview'}])
  const rows=result.cards[0].rows
  assert.equal(rows.length,14)
  for(const row of rows)assert.deepEqual(Object.keys(row),['date','netStars'])
  assert.equal(rows.slice(0,7).reduce((total,row)=>total+row.netStars,0),calculation.previous)
  assert.equal(rows.slice(7).reduce((total,row)=>total+row.netStars,0),calculation.current)
  assert.deepEqual(result.sources,[{id:'1',title:'Observed repository star totals',label:'Observed repository star totals',provider:'GitHub · observed repository star totals',queryId:'star_observations',observedAt:'2026-10-28T18:00:00.000Z',coverage:{startDate:'2026-08-29',endDate:'2026-10-27'},tab:'/overview',tabLabel:'Overview',url:'https://github.com/google/elephant-goldfish-model'}])
  assert.deepEqual(result.toolStatus,{name:'GitHub repository',status:'cached'})
  assert.equal(result.snapshotAt,'2026-10-28T18:05:00Z')
  assert.equal(result.generatedAt,'2026-10-28T19:00:00.000Z')
  assert.ok(!JSON.stringify(result).includes('token'))
})

test('uses all retained rows, not the bounded askContext sample',()=>{
  const sample=askContext(baseSnapshot,ANALYSIS_QUESTION).records.find(record=>record.queryId==='star_observations')
  assert.ok(sample.rows.length<starRows.length)
  assert.equal(sample.rowsTruncated,true)
  const result=analysisResult(baseSnapshot,now)
  assert.deepEqual(result.calculation.availableRange,{startDate:'2026-08-29',endDate:'2026-10-27'})
  assert.equal(result.calculation.boundaries[0].date,'2026-10-13')
})

test('unavailable results give reason and range, no chart and no invented zeros',()=>{
  const stale={...baseSnapshot,queries:{star_observations:{...observations,rows:starRows.slice(0,-1),source:{...observations.source,executedAt:'2026-10-27T18:00:00Z'}}}}
  const result=analysisResult(stale,now)
  assert.equal(result.calculation.status,'unavailable')
  assert.match(result.answer,/^The observed net star comparison is unavailable\. The latest closed sampling day is 2026-10-26, but 2026-10-27 is required\. Retained valid observations cover 2026-08-29 to 2026-10-26\. \[1\]$/)
  assert.deepEqual(result.cards,[])
  assert.equal(result.sources.length,1)
  assert.ok(!/\b0 stars|%/.test(result.answer))
  for(const key of ['previous','current','difference'])assert.ok(!(key in result.calculation))
})

test('without an observed query there is no citation or source',()=>{
  const result=analysisResult({generatedAt:'2026-10-28T18:05:00Z',queries:{}},now)
  assert.equal(result.calculation.status,'unavailable')
  assert.match(result.answer,/No retained repository star observations are available\.$/)
  assert.ok(!result.answer.includes('['))
  assert.deepEqual(result.sources,[])
  assert.deepEqual(result.cards,[])
})

test('does not mutate the snapshot',()=>{
  const frozen=deepFreeze(structuredClone(baseSnapshot))
  const before=JSON.stringify(frozen)
  analysisResult(frozen,now)
  assert.equal(JSON.stringify(frozen),before)
})

test('endpoint keeps auth, origin, quota and snapshot checks',async()=>{
  const {env}=environment()
  assert.equal((await handleAsk(request({question:ANALYSIS_QUESTION}),env,null,{now})).status,403)
  assert.equal((await handleAsk(request({question:ANALYSIS_QUESTION}),env,{id:'x',status:'pending'},{now})).status,403)
  assert.equal((await ask({question:ANALYSIS_QUESTION},env,{now})).status,200)
  assert.equal((await handleAsk(request({question:ANALYSIS_QUESTION},{headers:{origin:'https://evil.example'}}),env,user,{now})).status,403)
  assert.equal((await ask({question:ANALYSIS_QUESTION,history:'bad'},env)).status,400)
  assert.equal((await ask({question:ANALYSIS_QUESTION},environment({changes:0}).env)).status,429)
  const missing=await ask({question:ANALYSIS_QUESTION},environment({stored:false}).env)
  assert.equal(missing.status,503)
  assert.deepEqual(await missing.json(),{error:'snapshot_unavailable'})
})

test('works without model credentials, never calls a model or network, and writes only the quota audit',async()=>{
  const originalFetch=globalThis.fetch
  globalThis.fetch=()=>assert.fail('no network')
  try {
    const {env,sql}=environment()
    const response=await ask({question:ANALYSIS_QUESTION},env)
    assert.equal(response.status,200)
    assert.equal(response.headers.get('cache-control'),'private, no-store')
    assert.equal(response.headers.get('x-content-type-options'),'nosniff')
    const body=await response.json()
    assert.equal(body.calculation.difference,-35)
    assert.equal(sql.length,2)
    assert.match(sql[0],/^SELECT body,generated_at FROM snapshots/)
    assert.match(sql[1],/^INSERT INTO audit/)
    const modelEnv=environment({infer:{run:()=>assert.fail('must not infer')}}).env
    assert.equal((await ask({question:ANALYSIS_QUESTION,stream:true},modelEnv)).status,200)
  }finally{globalThis.fetch=originalFetch}
})

test('missing observations with otherwise empty context still return an unavailable result',async()=>{
  const empty={generatedAt:'2026-10-28T18:05:00Z',queries:{}}
  const response=await ask({question:ANALYSIS_QUESTION},environment({snapshot:empty}).env)
  assert.equal(response.status,200)
  const body=await response.json()
  assert.equal(body.calculation.status,'unavailable')
  assert.deepEqual(body.sources,[])
  // The model path keeps its existing empty-context rejection.
  const model=await ask({question:'How many views?'},environment({snapshot:empty,infer:{run:()=>assert.fail('must not infer')}}).env)
  assert.equal(model.status,503)
})

test('stream returns one result event matching the JSON response',async()=>{
  const json=await (await ask({question:ANALYSIS_QUESTION},environment().env)).json()
  const response=await ask({question:ANALYSIS_QUESTION,stream:true},environment().env)
  assert.equal(response.headers.get('content-type'),'application/x-ndjson; charset=utf-8')
  assert.equal(response.headers.get('cache-control'),'private, no-store')
  assert.equal(response.headers.get('x-content-type-options'),'nosniff')
  const events=await lines(response)
  assert.equal(events.length,1)
  const {type,...result}=events[0]
  assert.equal(type,'result')
  assert.deepEqual(result,json)
})

test('an already aborted stream closes without a result',async()=>{
  const controller=new AbortController()
  const req=request({question:ANALYSIS_QUESTION,stream:true},{signal:controller.signal})
  controller.abort()
  const response=await handleAsk(req,environment().env,user,{now,...noNetwork})
  assert.equal(response.status,200)
  assert.deepEqual(await lines(response),[])
})

test('unsupported questions and follow-ups keep the model path',async()=>{
  const asked=[]
  const infer={async run(_,input){asked.push(JSON.parse(input.messages.at(-1).content).question);return {response:'Model answer [S1]'}}}
  for(const body of [
    {question:'Compare EGM net star growth over the last 14 complete sampling days with the previous 14?'},
    {question:'Compare EGM net fork growth over the last 7 complete sampling days with the previous 7?'},
    {question:'Why?',history:[{question:ANALYSIS_QUESTION,answer:'Previous answer'}]}
  ]) {
    const response=await ask(body,environment({infer}).env,{waitUntil:()=>{}})
    assert.equal(response.status,200)
    const result=await response.json()
    assert.equal(result.answer,'Model answer [1]')
    assert.ok(!('calculation' in result))
  }
  assert.equal(asked.length,3)
  // Without model credentials an unsupported question is still unavailable.
  assert.equal((await ask({question:'How many views?'},environment().env)).status,503)
})
