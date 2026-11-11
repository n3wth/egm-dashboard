import test from 'node:test'
import assert from 'node:assert/strict'
import {criteria,evalDate,gptHeldOut,haikuHeldOut,journey,limits,versionRows,percent,decimal,whole} from './egm-lite-eval.mjs'

test('egm-lite eval keeps the reviewed held-out results and date',()=>{
  assert.equal(evalDate,'2026-11-11')
  const haiku=Object.fromEntries(haikuHeldOut.rows.map(row=>[row.measure,row.values]))
  assert.deepEqual(haikuHeldOut.columns,['v0.2.0','No skill','v0.1.0'])
  assert.deepEqual(haiku['Right decision'],['92%','63%','58%'])
  assert.deepEqual(haiku['Unsupported blockers per reply'],['0.8','3.4','3.4'])
  assert.deepEqual(haiku['Replies with an invented fact'],['12%','29%','21%'])
  assert.deepEqual(haiku['Words per reply'],['446','478','597'])
  const gpt=Object.fromEntries(gptHeldOut.rows.map(row=>[row.measure,row.values]))
  assert.deepEqual(gpt['Right decision, held-out cases'],['94%','81%'])
  assert.deepEqual(gpt['Unsupported blockers per reply, held-out'],['0.25','1.06'])
  for(const table of [haikuHeldOut,gptHeldOut])for(const row of table.rows)assert.equal(row.values.length,table.columns.length,row.measure)
})

test('success criteria report honest status for all nine criteria',()=>{
  assert.deepEqual(criteria.map(row=>row.id),['1','2','2b','3','4','5','6','7','8'])
  assert.ok(criteria.every(row=>['yes','no','partial'].includes(row.met)))
  assert.deepEqual(criteria.filter(row=>row.met!=='yes').map(row=>row.id),['1','2b','3','4'])
})

test('journey runs from the pilot to round 6 and limits are present',()=>{
  assert.equal(journey[0].step,'Pilot')
  assert.equal(journey.at(-1).step,'Round 6')
  for(const round of [0,1,2,3,4,5,6])assert.ok(journey.some(item=>item.step===`Round ${round}`),round)
  assert.ok(journey.every(item=>item.text&&item.result))
  assert.equal(limits.length,4)
})

test('per-version rows match results.csv on Claude Haiku 5.5 and mark v0.2.0',()=>{
  const final=versionRows.find(row=>row.variant.includes('v0.2.0'))
  assert.deepEqual([final.decision,final.blockers,final.soundClean,final.inventedFree,final.words],[0.92,0.613,0.348,0.72,393])
  const none=versionRows.find(row=>row.variant==='No skill')
  assert.deepEqual([none.decision,none.blockers,none.words],[0.705,1.779,404])
  assert.equal(new Set(versionRows.map(row=>row.variant)).size,versionRows.length)
  assert.deepEqual(versionRows.filter(row=>row.status==='accepted').map(row=>row.variant),['h1-b','h3-b','h5-c (v0.2.0)'])
  for(const row of versionRows)for(const field of ['decision','soundClean','inventedFree'])assert.ok(row[field]===null||(row[field]>=0&&row[field]<=1),`${row.variant} ${field}`)
})

test('formatters show a dash for missing values',()=>{
  assert.equal(percent(0.705),'71%')
  assert.equal(decimal(1.779),'1.78')
  assert.equal(whole(393),'393')
  for(const format of [percent,decimal,whole])assert.equal(format(null),'—')
})

test('page copy carries no costs, secrets or artifact links',async()=>{
  const {readFileSync}=await import('node:fs')
  for(const file of ['./egm-lite-eval.mjs','./EgmLite.jsx']) {
    const source=readFileSync(new URL(file,import.meta.url),'utf8')
    assert.doesNotMatch(source,/\$\d|claude\.ai|api[_-]?key|token=/i,file)
  }
})
