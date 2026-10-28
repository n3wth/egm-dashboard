import test from 'node:test'
import assert from 'node:assert/strict'
import {renderAccessPage} from './auth-pages.mjs'

test('sign-in page has one clear authentication action and no empty explanatory elements',async()=>{
  const response=renderAccessPage('signin')
  const html=await response.text()
  assert.equal(response.status,200)
  assert.match(html,/<h1>Sign in<\/h1>/)
  assert.match(html,/Design with an elephant\. Review with a goldfish\./)
  assert.match(html,/href="\/auth\/login" class="action"/)
  assert.equal((html.match(/Continue with Google/g)??[]).length,1)
  assert.doesNotMatch(html,/<p(?: class="note")?><\/p>/)
  assert.match(html,/Private access dashboard/)
  assert.match(html,/:focus-visible/)
  assert.match(response.headers.get('content-security-policy'),/form-action 'self'/)
})
test('unavailable invitations explain the next step without exposing a token',async()=>{
  const response=renderAccessPage('invite_invalid')
  const html=await response.text()
  assert.equal(response.status,403)
  assert.match(html,/<h1>This invitation is unavailable<\/h1>/)
  assert.match(html,/expired, been used, been revoked, or been sent to a different email address/)
  assert.match(html,/Without an invitation, access requires approval/)
  assert.equal(response.headers.get('cache-control'),'private, no-store')
  assert.equal(response.headers.get('referrer-policy'),'no-referrer')
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
test('temporary session failure offers a same-page retry without signing out',async()=>{
  const response=renderAccessPage('session_unavailable')
  const html=await response.text()
  assert.equal(response.status,503)
  assert.match(html,/<h1>Temporarily unavailable<\/h1>/)
  assert.match(html,/href="" class="action">Try again<\/a>/)
  assert.doesNotMatch(html,/\/auth\/logout|\/auth\/login/)
  assert.equal(response.headers.get('cache-control'),'private, no-store')
  assert.equal(response.headers.get('referrer-policy'),'no-referrer')
})
