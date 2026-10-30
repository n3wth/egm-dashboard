import test from 'node:test'
import assert from 'node:assert/strict'
import {askTableColumns,askCellText,humanize} from './ask-table.mjs'

test('url and title merge into one Source column',()=>{
  const columns=askTableColumns(['url','title','kind'],[{url:'https://example.com/a',title:'A page',kind:'Video'}])
  assert.deepEqual(columns.map(column=>column.field),['title','kind'])
  assert.equal(columns[0].label,'Source');assert.equal(columns[0].link,true);assert.equal(columns[0].clip,true)
  assert.equal(columns[1].label,'Kind');assert.equal(columns[1].clip,false)
})
test('url without a title field stays and is clipped',()=>{
  const columns=askTableColumns(['url','count'],[])
  assert.deepEqual(columns.map(column=>column.field),['url','count'])
  assert.equal(columns[0].clip,true);assert.equal(columns[0].label,'Link')
})
test('long text columns are clipped and explicit labels win',()=>{
  const columns=askTableColumns(['summary'],[{summary:'x'.repeat(60)}],{summary:'Why it matters'})
  assert.equal(columns[0].clip,true);assert.equal(columns[0].label,'Why it matters')
})
test('tooltip carries the full value and the url for the source column',()=>{
  const column={link:true}
  assert.deepEqual(askCellText('A page',{url:'https://example.com/a'},column),{text:'A page',tooltip:'A page\nhttps://example.com/a'})
  assert.deepEqual(askCellText(null,{},{link:false}),{text:'—',tooltip:'—'})
})
test('humanize turns field names into labels',()=>{
  assert.equal(humanize('first_seen'),'First seen');assert.equal(humanize('shareOfRepoViews'),'Share Of Repo Views'.replace('Of','Of'))
})
