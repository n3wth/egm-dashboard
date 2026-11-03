import test from 'node:test'
import assert from 'node:assert/strict'
import {analysisSummary,savedAnalysis} from './saved-analysis.mjs'

const now=Date.parse('2026-11-02T20:00:00Z')
const queries=()=>({
  traffic:{rows:[{date:'2026-10-31',views:2}],source:{executedAt:'2026-11-02T18:00:00Z'}},
  daily_analysis_input_traffic:{rows:[{date:'2026-10-31',views:2}],source:{executedAt:'2026-11-02T18:00:00Z'}},
  daily_analysis:{rows:[{id:'overview',headline:'Attention is visible.',summary:'Successful use remains unmeasured.',nextStep:'Observe the first workflow.',queryIds:['traffic'],unknowns:['Retention is unmeasured.'],confidence:'low'}],source:{model:'gemini-flash-lite-latest',executedAt:'2026-11-02T19:00:00Z',inputSources:[{queryId:'traffic',observedAt:'2026-11-02T18:00:00Z'}]}}
})

test('saved interpretation preserves source evidence and explicit unknowns without changing metrics',()=>{
  const source=queries(),before=structuredClone(source)
  const result=analysisSummary({headline:'Computed fact',facts:['2 views'],queryIds:['traffic'],notes:['Traffic uses UTC days.']},source,'overview',now)
  assert.equal(result.headline,'Attention is visible.')
  assert.deepEqual(result.facts,['Successful use remains unmeasured.'])
  assert.deepEqual(result.queryIds,['daily_analysis','daily_analysis_input_traffic'])
  assert.ok(result.notes.includes('Unknown: Retention is unmeasured.'))
  assert.ok(result.notes.includes('Traffic uses UTC days.'))
  assert.equal(result.analysis.stale,false)
  assert.deepEqual(source,before)
  source.traffic.rows[0].views=99
  const changed=analysisSummary(null,source,'overview',now)
  assert.deepEqual(changed.queryIds,['daily_analysis','daily_analysis_input_traffic'])
  assert.equal(source[changed.queryIds[1]].rows[0].views,2,'inspection resolves the original model input, not the newer dashboard rows')
})

test('source changes, a different Pacific date and failed generation identify saved analysis as older',()=>{
  const changed=queries();changed.traffic.source.executedAt='2026-11-02T19:30:00Z'
  assert.equal(savedAnalysis(changed,'overview',now).newerSources,true)
  assert.equal(savedAnalysis(changed,'overview',now).stale,true)
  const fallback={headline:'Current calculated result',facts:['Updated values'],queryIds:['traffic']}
  const current=analysisSummary(fallback,changed,'overview',now)
  assert.equal(current.headline,fallback.headline)
  assert.equal(current.analysis,null)
  assert.equal(current.previousAnalysis.stale,true)
  assert.equal(savedAnalysis(queries(),'overview',now+86400000).stale,true)
  const failed=queries();failed.daily_analysis_status={rows:[{status:'stale',reason:'generation_failed'}]}
  assert.equal(savedAnalysis(failed,'overview',now).stale,true)
  const revalidated=queries();revalidated.daily_analysis.source.inputFingerprint='original'
  revalidated.daily_analysis_status={rows:[{status:'cached',inputFingerprint:'changed-without-restamping'}]}
  assert.equal(savedAnalysis(revalidated,'overview',now).stale,true)
  assert.equal(savedAnalysis(revalidated,'overview',now).newerSources,true)
})

test('missing, future or uncited analysis leaves the computed fallback clearly identifiable',()=>{
  const fallback={headline:'Computed fact',facts:['2 views'],queryIds:['traffic']}
  assert.deepEqual(analysisSummary(fallback,{},'overview',now),{...fallback,analysis:null})
  assert.equal(analysisSummary(null,{},'overview',now),null)
  assert.equal(savedAnalysis(queries(),'overview',Date.parse('2026-11-02T18:00:00Z')),null)
  const missing=queries();delete missing.traffic
  assert.equal(savedAnalysis(missing,'overview',now),null)
})
