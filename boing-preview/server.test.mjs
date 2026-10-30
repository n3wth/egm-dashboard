import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPreviewServer } from './server.mjs'

test('preview serves only local mock pages and scoped fictional data', async t => {
  const server = createPreviewServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const landing = await (await fetch(`${base}/`)).text()
  assert.match(landing, /Fictional data/)
  for (const path of ['/product.html', '/features.html', '/terms.html', '/privacy.html']) {
    const page = await fetch(`${base}${path}`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /LOCAL DEVELOPMENT PREVIEW/)
  }
  const wasm = await fetch(`${base}/rive/vendor/rive.wasm`)
  assert.equal(wasm.headers.get('content-type'), 'application/wasm')
  assert.deepEqual(Array.from(new Uint8Array(await wasm.arrayBuffer()).slice(0, 4)), [0, 97, 115, 109])
  assert.equal((await fetch(`${base}/rive/momentum.riv`)).status, 200)
  assert.equal((await fetch(`${base}/rive/scene.rml`)).status, 404)
  assert.doesNotMatch(landing, /https:\/\/app\.boing\.run\//)
  assert.match(await (await fetch(`${base}/app/`)).text(), /No real sign-in/)
  assert.equal((await fetch(`${base}/egm-cloudflare/worker.mjs`)).status, 404)
  assert.equal((await fetch(`${base}/api/boing/projects`)).status, 404)
  assert.equal((await fetch(`${base}/api/boing/projects/demo-comet/sources`, { headers: { 'x-boing-organization': 'demo-sprout' } })).status, 404)
  assert.equal((await fetch(`${base}/api/boing/projects/demo-comet/export`, { headers: { 'x-boing-organization': 'demo-sprout' } })).status, 404)
  const exported = await fetch(`${base}/api/boing/projects/demo-garden/export`, { headers: { 'x-boing-organization': 'demo-sprout' } })
  assert.equal((await exported.json()).project.id, 'demo-garden')
  const response = await fetch(`${base}/api/boing/projects/demo-garden/sources`, { headers: { 'x-boing-organization': 'demo-sprout' } })
  assert.equal((await response.json()).sources[0].data.metrics.stars, 128)
  assert.equal((await fetch(`${base}/api/boing/projects`, { method: 'POST' })).status, 405)
})
