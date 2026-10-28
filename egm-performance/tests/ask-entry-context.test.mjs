import test from 'node:test'
import assert from 'node:assert/strict'
import {selectionAskQuestion} from '../src/content/dashboard/ask-entry-context.mjs'
test('selection Ask preserves chart/text context as quoted data with a bounded editable question',()=>{
  assert.equal(selectionAskQuestion('How is EGM?'),'How is EGM?')
  const selected=selectionAskQuestion('',{kind:'text',label:'817 referrals',componentTitle:'Website'})
  assert.match(selected,/Explain this selection/)
  assert.match(selected,/Website.*817 referrals/)
  assert.match(selectionAskQuestion('Why?',{chartType:'line',label:'Oct 28',series:'Stars',value:0}),/Stars.*0/)
  assert.ok(selectionAskQuestion('a'.repeat(1500),{label:'b'.repeat(1000)}).length<=1200)
})
