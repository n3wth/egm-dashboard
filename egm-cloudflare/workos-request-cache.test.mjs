import test from 'node:test'
import assert from 'node:assert/strict'
import { cachedWorkosRead } from './workos-request-cache.mjs'

test('successful WorkOS reads are reused and failures are not', async () => {
  const env = {}
  let now = 1_000
  let calls = 0
  const load = async () => {
    calls++
    return calls === 2 ? { cacheable: false, status: 'unavailable' } : { cacheable: true, status: 'active', n: calls }
  }
  const first = await cachedWorkosRead(env, 'session', 45_000, load, () => now)
  const second = await cachedWorkosRead(env, 'session', 45_000, load, () => now + 1_000)
  assert.equal(calls, 1)
  assert.equal(second.n, first.n)
  now += 45_000
  const missed = await cachedWorkosRead(env, 'session', 45_000, load, () => now)
  assert.equal(missed.status, 'unavailable')
  assert.equal(calls, 2)
  const afterFailure = await cachedWorkosRead(env, 'session', 45_000, load, () => now)
  assert.equal(afterFailure.n, 3)
  assert.equal(calls, 3)
})

test('callers that arrive during one read share it', async () => {
  const env = {}
  let calls = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const load = async () => {
    calls++
    await gate
    return { cacheable: true, status: 'active' }
  }
  const pending = [cachedWorkosRead(env, 'admin', 45_000, load), cachedWorkosRead(env, 'admin', 45_000, load)]
  release()
  const results = await Promise.all(pending)
  assert.equal(calls, 1)
  assert.deepEqual(results.map(item => item.status), ['active', 'active'])
})
