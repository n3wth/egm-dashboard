import test from 'node:test'
import assert from 'node:assert/strict'
import {readBody} from './request-body.mjs'

test('reads split UTF-8 up to the byte limit', async () => {
  const bytes = new TextEncoder().encode('a€')
  const body = new ReadableStream({start(controller) {
    controller.enqueue(bytes.slice(0, 2))
    controller.enqueue(bytes.slice(2))
    controller.close()
  }})
  assert.equal(await readBody(new Request('https://example.test', {method:'POST', body, duplex:'half'}), 4), 'a€')
})

test('stops oversized streams without relying on content length', async () => {
  let cancelled = false
  const body = new ReadableStream({pull(controller) {
    controller.enqueue(new Uint8Array(5))
  }, cancel() { cancelled = true }})
  assert.equal(await readBody(new Request('https://example.test', {method:'POST', body, duplex:'half'}), 4), null)
  assert.equal(cancelled, true)
})

test('rejects a declared oversized body before reading it', async () => {
  const request = new Request('https://example.test', {method:'POST', headers:{'content-length':'10'}, body:'x'})
  assert.equal(await readBody(request, 4), null)
  assert.equal(request.bodyUsed, false)
})
