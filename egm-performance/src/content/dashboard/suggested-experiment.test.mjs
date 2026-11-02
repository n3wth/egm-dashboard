import test from 'node:test'
import assert from 'node:assert/strict'
import {experimentRule,suggestExperiment} from './suggested-experiment.mjs'

const issue=(title,number,comments=0)=>({title,comments,url:`https://github.com/google/elephant-goldfish-model/issues/${number}`})

test('explicit first-use friction outranks unrelated popular requests and documentation routing',()=>{
  const result=suggestExperiment({issue_queue:{rows:[issue('Add another language integration',1,500),issue('Documentation links are confusing',2,100),issue('Installation failed on a clean machine',3,0)]}})
  assert.equal(result.category,'first-use')
  assert.equal(result.winner.title,'Installation failed on a clean machine')
  assert.equal(result.winner.score,3)
  assert.equal(result.rule,experimentRule)
  assert.match(result.action,/five new users/)
  assert.ok(result.evidence.every(item=>item.url===result.winner.url))
})

test('documentation evidence produces a routing test instead of a generic workflow test',()=>{
  const result=suggestExperiment({issue_queue:{rows:[issue('README guide is hard to find',2)]}})
  assert.equal(result.category,'docs')
  assert.equal(result.winner.score,2)
  assert.match(result.action,/find installation and the first-workflow instructions/)
  assert.match(result.success,/routing change/)
})

test('URL-only verified excerpts and generic mentions cannot manufacture an experiment',()=>{
  for(const contentExcerpt of ['https://example.com/installation-failed','[.](https://example.com/installation-failed)','installation-failed.html#)']) {
    assert.equal(suggestExperiment({research_evidence:{rows:[{status:'verified',title:'Installation failed',url:'https://example.com/review',contentExcerpt}]},mentions:{rows:[{title:'Installation failed',url:'https://example.com/post'}]}}),null)
  }
  assert.equal(suggestExperiment({issue_queue:{rows:[issue('Support an additional provider',1,1000)]},mentions:{rows:[{title:'EGM is interesting',url:'https://example.com/post'}]}}),null)
})

test('verified prose can support a test but an unavailable or URL-only source body cannot',()=>{
  const row={status:'verified',title:'A first-run report',url:'https://example.com/report',contentExcerpt:'The installation failed before the first workflow.'}
  const result=suggestExperiment({research_evidence:{rows:[row]}})
  assert.equal(result.category,'first-use')
  assert.equal(result.winner.kind,'quote')
  assert.equal(result.evidence[0].quote,row.contentExcerpt)
  assert.equal(suggestExperiment({research_evidence:{rows:[{...row,status:'unverified'}]}}),null)
  assert.equal(suggestExperiment({research_evidence:{rows:[{...row,rawMarkdown:'[.](https://example.com/installation-failed)'}]}}),null)
})

test('distribution requires observed positive referral counts and retains rolling-window limits',()=>{
  for(const count of [null,undefined,NaN,-1,0,'10'])assert.equal(suggestExperiment({referrers:{rows:[{referrer:'Google',count}]}}),null)
  for(const referrer of [null,undefined,''])assert.equal(suggestExperiment({referrers:{rows:[{referrer,count:10}]}}),null)
  const result=suggestExperiment({referrers:{rows:[{referrer:'youtube.com',count:25},{referrer:'linkedin.com',count:20},{referrer:'com.linkedin.android',count:10}]}})
  assert.equal(result.category,'distribution')
  assert.equal(result.winner.title,'LinkedIn: 30 recorded referral views')
  assert.equal(result.winner.url,'https://github.com/google/elephant-goldfish-model/graphs/traffic')
  assert.match(result.action,/audience arriving via LinkedIn/)
  assert.match(result.success,/rolling 14-day referral count/)
  assert.match(result.success,/cannot establish causal lift or conversion/)
})

test('ties use source kind then URL, not comment counts or input order',()=>{
  const rows=[issue('Setup failed for a new user',20,100),issue('Setup failed on a clean machine',10,0)]
  const result=suggestExperiment({issue_queue:{rows},research_evidence:{rows:[{status:'verified',url:'https://example.com/a',contentExcerpt:'The installation failed for new users.'}]}})
  const reverse=suggestExperiment({issue_queue:{rows:[...rows].reverse()}})
  assert.equal(result.winner.url,rows[1].url)
  assert.equal(reverse.winner.url,result.winner.url)
  assert.equal(result.evidence.length,3)
})
