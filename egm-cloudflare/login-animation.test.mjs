import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('stale Rive callbacks cannot replace the active artwork', async () => {
  const classes = new Set(), listeners = {}, instances = []
  const reduced = { matches: false, addEventListener: (_, listener) => { listeners.reduced = listener } }
  const handoff = { classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) }, querySelector: () => ({}) }
  const window = {
    matchMedia: () => reduced,
    addEventListener: () => {},
    rive: {
      RuntimeLoader: { setWasmUrl() {}, setWasmFallbackUrl() {} },
      Rive: class {
        constructor(options) { this.options = options; this.resizes = 0; instances.push(this) }
        resizeDrawingSurfaceToCanvas() { this.resizes++ }
        cleanup() {}
      },
    },
  }
  runInNewContext(await readFile(new URL('./login-animation.js', import.meta.url), 'utf8'), { window, document: { querySelector: () => handoff } })
  const first = instances[0]
  reduced.matches = true
  listeners.reduced()
  reduced.matches = false
  listeners.reduced()
  const second = instances[1]
  second.options.onLoad()
  first.options.onLoadError()
  first.options.onLoad()
  assert.equal(classes.has('ready'), true)
  assert.equal(first.resizes, 0)
  assert.equal(second.resizes, 1)
  reduced.matches = true
  listeners.reduced()
  second.options.onLoad()
  assert.equal(classes.has('ready'), false)
})
