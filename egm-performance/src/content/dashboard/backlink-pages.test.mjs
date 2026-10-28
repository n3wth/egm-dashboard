import test from 'node:test'
import assert from 'node:assert/strict'
import {backlinkPages} from './backlink-pages.js'

test('canonical source pages merge anchors and earliest crawl without mutating source rows',()=>{
  const rows=[{source_url:'https://NEWS.facts.dev:443/story#one',anchor:'EGM',first_seen:200},{source_url:'https://news.facts.dev/story#two',anchor:'Model',first_seen:100},{source_url:'https://news.facts.dev/story',anchor:'EGM',first_seen:300}]
  const original=structuredClone(rows)
  const result=backlinkPages(rows)
  assert.equal(result.length,1)
  assert.equal(result[0].anchor,'EGM · Model')
  assert.equal(result[0].first_seen,100)
  assert.deepEqual(rows,original)
})
test('pagination query strings and invalid source rows stay distinct',()=>{
  const rows=[{source_url:'https://news.ycombinator.com/?p=1'},{source_url:'https://news.ycombinator.com/?p=2'},{source_url:null},{source_url:null}]
  assert.equal(backlinkPages(rows).length,4)
})
