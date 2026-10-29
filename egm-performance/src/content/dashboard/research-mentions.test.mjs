import test from 'node:test'
import assert from 'node:assert/strict'
import {safeExternalUrl, mostViewedDoc, mentionGroup, earliestValidDate, canonicalMentionUrl, uniqueMentionKey, matchingEngagement, validCrawlDate} from './research-mentions.mjs'

test('external links accept only HTTP URLs without credentials',()=>{
  assert.equal(safeExternalUrl('https://example.com/path'), 'https://example.com/path')
  for(const url of ['javascript:alert(1)', 'https://user:pass@example.com', '/relative', null, 'invalid']) assert.equal(safeExternalUrl(url), null)
})

test('the documentation recommendation uses the highest measured view count',()=>{
  const rows=[{path:'/repo/docs/a',count:2},{path:'/repo/docs/b',count:9},{path:'/repo/docs/c',count:null},{path:null,count:20}]
  assert.equal(mostViewedDoc(rows),rows[1])
  assert.equal(mostViewedDoc([]),undefined)
  const split=[
    {path:'/google/elephant-goldfish-model/blob/main/docs/getting_started.md',count:400},
    {path:'/google/elephant-goldfish-model/blob/HEAD/docs/getting_started.md',count:400},
    {path:'/google/elephant-goldfish-model/blob/main/docs/harnesses.md',count:500}
  ]
  const winner=mostViewedDoc(split)
  assert.equal(winner.count,800)
  assert.equal(winner.combined,true)
  assert.equal(winner.path,'/google/elephant-goldfish-model/blob/main/docs/getting_started.md')
})

test('uncategorized mentions remain visible in an other group',()=>{
  assert.equal(mentionGroup('Social'),'Social')
  assert.equal(mentionGroup('unknown'),'Other')
  assert.equal(mentionGroup(null),'Other')
})

test('earliest collection date ignores invalid values',()=>{
  assert.equal(earliestValidDate([{firstSeen:'invalid'},{firstSeen:'2026-10-10'},{firstSeen:'2026-10-01'}]),'2026-10-01')
  assert.equal(earliestValidDate([{firstSeen:'invalid'}]),null)
})

test('missing and malformed URLs cannot match unrelated engagement records',()=>{
  assert.equal(canonicalMentionUrl(undefined),null)
  assert.equal(canonicalMentionUrl('invalid'),null)
  assert.notEqual(uniqueMentionKey(undefined),uniqueMentionKey(undefined))
  assert.equal(uniqueMentionKey('https://example.com/item?utm_source=a'),uniqueMentionKey('https://example.com/item'))
  assert.equal(matchingEngagement({title:'No URL'},[{comments:99}]),undefined)
  assert.equal(matchingEngagement({url:'https://example.com/item?utm_source=test'},[{url:'https://example.com/item',comments:2}]).comments,2)
})

test('crawl timestamps reject nonfinite and out-of-range values',()=>{
  assert.equal(validCrawlDate(Infinity),null)
  assert.equal(validCrawlDate(1e20),null)
  assert.equal(validCrawlDate(8640000000000),null)
  assert.equal(validCrawlDate(-8640000000000),null)
  assert.equal(validCrawlDate(null),null)
  assert.equal(validCrawlDate(100),'1970-01-01')
})
