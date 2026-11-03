import test from 'node:test'
import assert from 'node:assert/strict'
import {getSessionWidgetToken,getAuthenticationSettings} from '../src/content/dashboard/workos-session-requests.mjs'

test('account requests have a deadline, preserve cancellation and validate returned settings',async t=>{
  try {
    const caller=new AbortController()
    const received=[]
    t.mock.method(AbortSignal,'timeout',milliseconds=>{
      assert.equal(milliseconds,15000)
      const deadline=new AbortController()
      queueMicrotask(()=>deadline.abort(new DOMException('Timed out','TimeoutError')))
      return deadline.signal
    })
    t.mock.method(globalThis,'fetch',async(url,init)=>{
      received.push({url,init})
      return new Promise((resolve,reject)=>{
        if(init.signal.aborted)reject(init.signal.reason)
        else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true})
      })
    })
    await assert.rejects(getSessionWidgetToken(caller.signal),{name:'TimeoutError'})
    await assert.rejects(getAuthenticationSettings('fixture-token',caller.signal),{name:'TimeoutError'})
    assert.equal(caller.signal.aborted,false,'request deadlines must not cancel the enclosing dialog')
    assert.equal(received[0].init.credentials,'same-origin')
    assert.equal(received[1].init.credentials,'omit')
    assert.equal(received[1].init.cache,'no-store')
    t.mock.restoreAll()

    caller.abort()
    t.mock.method(globalThis,'fetch',async(url,init)=>{init.signal.throwIfAborted();return Response.json({})})
    await assert.rejects(getSessionWidgetToken(caller.signal),{name:'AbortError'})
    t.mock.restoreAll()

    t.mock.method(globalThis,'fetch',async()=>Response.json(null))
    await assert.rejects(getSessionWidgetToken(),/Sessions are temporarily unavailable/)
    t.mock.restoreAll()
    t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:401}))
    await assert.rejects(getSessionWidgetToken(),error=>error.status===401&&/Sign in again/.test(error.message))
    t.mock.restoreAll()
    t.mock.method(globalThis,'fetch',async()=>Response.json({data:{authenticationSettings:{mfaEnabled:true,passwordAuthEnabled:false}}}))
    assert.deepEqual(await getAuthenticationSettings('fixture-token'),{mfaEnabled:true,passwordAuthEnabled:false})
    t.mock.restoreAll()
    t.mock.method(globalThis,'fetch',async()=>Response.json({data:{authenticationSettings:{mfaEnabled:'true',passwordAuthEnabled:false}}}))
    await assert.rejects(getAuthenticationSettings('fixture-token'),/Security settings are temporarily unavailable/)
  } finally {t.mock.restoreAll()}
})
