import test from 'node:test'
import assert from 'node:assert/strict'
import {renderAccessPage} from './auth-pages.mjs'

test('sign-in page has one clear authentication action and no empty explanatory elements',async()=>{
  const response=renderAccessPage('signin')
  const html=await response.text()
  assert.equal(response.status,200)
  assert.match(html,/<h1>Sign in<\/h1>/)
  assert.match(html,/href="\/auth\/login" class="action"/)
  assert.equal((html.match(/Continue with Google/g)??[]).length,1)
  assert.doesNotMatch(html,/<p(?: class="note")?><\/p>/)
  assert.match(html,/Private access dashboard/)
  assert.match(html,/:focus-visible/)
  assert.match(response.headers.get('content-security-policy'),/form-action 'self'/)
})
test('restricted account states retain sign-out POST and private uncached responses',async()=>{
  for(const state of ['pending','denied']) {
    const response=renderAccessPage(state)
    const html=await response.text()
    assert.equal(response.status,403)
    assert.match(html,/<form action="\/auth\/logout" method="post">/)
    assert.equal(response.headers.get('cache-control'),'private, no-store')
    assert.match(html,/M4\.35 13\.6H3/)
  }
})
