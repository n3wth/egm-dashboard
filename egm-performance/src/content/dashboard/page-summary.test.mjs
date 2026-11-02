import test from 'node:test'
import assert from 'node:assert/strict'
import {pageSummary} from './page-summary.mjs'
test('all pages omit unsupported claims when queries are missing',()=>{for(const page of ['acquisition','adoption','website','development','research','mentions'])assert.equal(pageSummary(page),null)})
test('acquisition groups LinkedIn variants and preserves top-referrer denominator',()=>{const result=pageSummary('acquisition',{referrers:{rows:[{referrer:'linkedin.com',count:30},{referrer:'com.linkedin.android',count:40},{referrer:'Google',count:20}]},reach:{rows:[{views:200}]},traffic:{rows:[{date:'2026-10-23'},{date:'2026-10-26'}]}});assert.match(result.sentences[0],/LinkedIn.*70/);assert.match(result.sentences[1],/45% of all repo views/);assert.equal(result.headline,'LinkedIn leads recorded referrals.');assert.deepEqual(result.facts,['70 referral views']);assert.ok(result.notes.includes('Top ten referrers account for 45% of repo views; the rest is unattributed.'));assert.deepEqual(result.range,{label:'Oct 22, 5 PM PDT – Oct 26, 5 PM PDT',note:'Pacific Time'});assert.deepEqual(result.queryIds,['referrers','reach'])})
test('adoption uses period-level unique cloners and never sums daily uniques',()=>{const result=pageSummary('adoption',{reach:{rows:[{clones:20,cloners:9}]},traffic:{rows:[{cloners:7},{cloners:7}]}});assert.match(result.sentences[0],/9 unique cloners/);assert.deepEqual(result.queryIds,['reach'])})
test('mentions count only measured video rows and distinguish unavailable views',()=>{const result=pageSummary('mentions',{youtube_videos:{rows:[{views:100},{views:null},{views:20}]}});assert.match(result.sentences[0],/100 views.*2 of 3/);assert.deepEqual(result.queryIds,['youtube_videos'])})
test('development keeps current queue separate from reported activity',()=>{const result=pageSummary('development',{maintenance:{rows:[{openIssues:3,openPRs:2}]},activity:{rows:[{mergedPRs:4},{mergedPRs:5}]}});assert.match(result.sentences[0],/3 open issues and 2 open PRs/);assert.match(result.sentences[1],/9 PRs.*two-week activity window/);assert.equal(result.sentences.length,2)})
test('website summary says referral counts are unknown instead of zero when egm.dev is outside the top ten',()=>{const result=pageSummary('website',{website:{rows:[{referralViews:null,referralVisitors:null}]},website_contribution:{rows:[{rank:null,topTenShare:null}]}});assert.match(result.sentences[0],/counts are unknown/);assert.equal(result.sentences.length,1)})

test('displayed page summaries round large counts and retain measurement limits',()=>{
  const adoption=pageSummary('adoption',{reach:{rows:[{clones:51957,cloners:18100}]}})
  assert.equal(adoption.headline,'First use and retention are still unmeasured.')
  assert.equal(adoption.facts[0],'52k clone operations from 18.1k unique cloners in the traffic window.')
  const website=pageSummary('website',{website:{rows:[{referralViews:4567,referralVisitors:2345}]},website_contribution:{rows:[{rank:5}]}})
  assert.equal(website.headline,'egm.dev is sending visitors to the repo.')
  assert.deepEqual(website.facts,['2.3k visitors · 4.6k referral views'])
  assert.ok(website.notes.includes('#5 among reported referrers'))
  const mentions=pageSummary('mentions',{youtube_videos:{rows:[{views:150399},{views:null}]}})
  assert.equal(mentions.headline,'The leading recorded video has 150.4k views.')
  assert.deepEqual(mentions.facts,['View counts available for 1 of 2 discovered videos.'])
  assert.equal(mentions.range,null)
})

test('plain-language research summary keeps checked evidence separate from indexed leads',()=>{
  const result=pageSummary('research',{research_evidence:{rows:[{status:'verified'},{status:'unverified'}]},exa_research:{rows:[{},{}]}})
  assert.equal(result.headline,'Checked pages confirm EGM references.')
  assert.deepEqual(result.facts,['1 verified page'])
  assert.ok(result.notes.includes('2 indexed leads to review, separate from verified evidence.'))
  assert.deepEqual(result.queryIds,['research_evidence','exa_research'])
  assert.equal(result.range,null)
})
