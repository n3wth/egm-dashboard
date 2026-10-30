import test from 'node:test'
import assert from 'node:assert/strict'
import {renderAccessPage} from './auth-pages.mjs'

test('sign-in page has one clear authentication action and no empty explanatory elements',async()=>{
  const response=renderAccessPage('signin')
  const html=await response.text()
  assert.equal(response.status,200)
  assert.match(html,/<h1 class="visually-hidden">Sign in<\/h1>/)
  assert.doesNotMatch(html,/Design with an elephant\. Review with a goldfish\./)
  assert.match(html,/href="\/auth\/login" class="action"/)
  assert.equal((html.match(/Continue with Google/g)??[]).length,1)
  assert.doesNotMatch(html,/<p(?: class="note")?><\/p>/)
  assert.doesNotMatch(html,/Private access dashboard/)
  assert.match(html,/:focus-visible/)
  assert.match(response.headers.get('content-security-policy'),/form-action 'self'/)
  assert.match(html,/<script defer src="\/rive\/egm-login\.js"><\/script>/)
  assert.match(html,/<svg viewBox="0 0 240 88"/)
  assert.match(response.headers.get('content-security-policy'),/script-src 'self' 'wasm-unsafe-eval'/)
  assert.match(html,/<canvas class="handoff-canvas" tabindex="-1"><\/canvas>/)
})
test('unavailable invitations explain the next step without exposing a token',async()=>{
  const response=renderAccessPage('invite_invalid')
  const html=await response.text()
  assert.equal(response.status,403)
  assert.doesNotMatch(html,/egm-login\.js/)
  assert.match(html,/<h1>This invitation is unavailable<\/h1>/)
  assert.match(html,/expired, been used, been revoked, or been sent to a different email address/)
  assert.match(html,/Without an invitation, access requires approval/)
  assert.equal(response.headers.get('cache-control'),'private, no-store')
  assert.equal(response.headers.get('referrer-policy'),'same-origin')
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
  assert.equal(response.headers.get('referrer-policy'),'same-origin')
})
test('every dead-end state has its status, no-store headers, noindex and one action',async()=>{
  const expected={not_found:404,invite_denied:403,login_cancelled:401,login_expired:400,session_expired:401,rate_limited:429,unavailable:503,invite_account:403,invite_invalid:403,pending:403,denied:403,error:401}
  for(const [state,status] of Object.entries(expected)) {
    const response=renderAccessPage(state)
    const html=await response.text()
    assert.equal(response.status,status,state)
    assert.equal(response.headers.get('cache-control'),'private, no-store',state)
    assert.match(html,/<meta name="robots" content="noindex, nofollow">/,state)
    assert.equal((html.match(/class="action[ "]/g)??[]).length,1,state)
    assert.doesNotMatch(html,/—/,state)
    assert.doesNotMatch(html,/egm-login\.js/,state)
  }
})
test('not found, wrong account and retry pages link to the right next step',async()=>{
  assert.match(await renderAccessPage('not_found').text(),/href="\/" class="action">Open the dashboard/)
  assert.match(await renderAccessPage('invite_account').text(),/href="\/auth\/invite" class="action">Try again/)
  const limited=renderAccessPage('rate_limited')
  assert.equal(limited.headers.get('retry-after'),'60')
  assert.match(await limited.text(),/href="" class="action">Try again/)
  const retry=renderAccessPage('unavailable',{href:'/auth/login',headers:{'set-cookie':'a=b'}})
  assert.equal(retry.headers.get('set-cookie'),'a=b')
  assert.match(await retry.text(),/href="\/auth\/login" class="action">Try again/)
  assert.equal(renderAccessPage('login_expired',{headers:{'content-type':'text/plain'}}).headers.get('content-type'),'text/html;charset=utf-8')
})
test('pages that host POST forms keep the origin so same-origin checks pass',async()=>{
  for(const state of ['invite','pending','denied']) assert.equal(renderAccessPage(state).headers.get('referrer-policy'),'same-origin',state)
})
test('the reopen invitation page offers no sign-in that would skip the invitation',async()=>{
  const response=renderAccessPage('invite_reopen')
  const html=await response.text()
  assert.equal(response.status,400)
  assert.match(html,/<h1>Open your invitation again<\/h1>/)
  assert.doesNotMatch(html,/class="action[ "]|\/auth\/login|Continue with Google/)
  assert.doesNotMatch(html,/—/)
})
