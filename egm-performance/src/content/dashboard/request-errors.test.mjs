import test from 'node:test'
import assert from 'node:assert/strict'
import {NETWORK_MESSAGE,TIMEOUT_MESSAGE,failureMessage,retryableStatus,statusMessage} from './request-errors.mjs'

test('status messages cover session expiry and rate limits, else the fallback',()=>{
  assert.match(statusMessage(401,'x'),/session expired/)
  assert.match(statusMessage(429,'x'),/Too many requests/)
  assert.equal(statusMessage(500,'Could not load users.'),'Could not load users.')
})
test('network and timeout failures replace the raw browser error',()=>{
  assert.equal(failureMessage(new TypeError('Failed to fetch'),'x'),NETWORK_MESSAGE)
  assert.equal(failureMessage(new DOMException('Aborted','AbortError'),'x',{timedOut:true}),TIMEOUT_MESSAGE)
  assert.equal(failureMessage(new DOMException('signal timed out','TimeoutError'),'x'),TIMEOUT_MESSAGE)
  assert.equal(failureMessage(new Error('Could not update access.'),'x'),'Could not update access.')
  assert.equal(failureMessage(new SyntaxError('Unexpected token <'),'fallback'),'fallback')
  assert.equal(failureMessage(undefined,'fallback'),'fallback')
})
test('only transient statuses are worth retrying',()=>{
  for(const status of [401,403,429])assert.equal(retryableStatus(status),false)
  for(const status of [400,404,500,503])assert.equal(retryableStatus(status),true)
})
