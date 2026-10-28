import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('stale Rive callbacks cannot replace the active artwork', async () => {
  const classes = new Set(), listeners = {}, instances = [], frames = new Map()
  let frameId = 0
  const reduced = { matches: false, addEventListener: (_, listener) => { listeners.reduced = listener } }
  const handoff = { classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) }, querySelector: () => ({}) }
  const window = {
    matchMedia: () => reduced,
    addEventListener: () => {},
    rive: {
      RuntimeLoader: { setWasmUrl() {}, setWasmFallbackUrl() {} },
      Rive: class {
        constructor(options) { this.options = options; this.resizes = 0; this.values = new Map(); this.viewModelInstance = { number: name => { if (!this.values.has(name)) this.values.set(name, { value: 100 }); return this.values.get(name) } }; instances.push(this) }
        resizeDrawingSurfaceToCanvas() { this.resizes++ }
        cleanup() {}
      },
    },
  }
  const document = { hidden: false, querySelector: () => handoff }
  const math = Object.assign(Object.create(Math), { random: () => 0.5 })
  runInNewContext(await readFile(new URL('./login-animation.js', import.meta.url), 'utf8'), { window, document, Math: math, requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId }, cancelAnimationFrame: id => frames.delete(id) })
  const first = instances[0]
  reduced.matches = true
  listeners.reduced()
  reduced.matches = false
  listeners.reduced()
  const second = instances[1]
  second.viewModelInstance.number('bootstrapX').value = 1000
  second.viewModelInstance.number('brainstormX').value = 101
  second.options.onLoad()
  first.options.onLoadError()
  first.options.onLoad()
  assert.equal(classes.has('ready'), true)
  assert.equal(first.resizes, 0)
  assert.equal(second.resizes, 1)
  assert.equal(second.options.autoBind, true)
  assert.equal(frames.size, 1)
  const step = time => { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(time) }
  step(0)
  step(50)
  const position = second.values.get('bootstrapX').value
  assert.ok(position <= 556)
  assert.ok(second.values.get('brainstormX').value > 101, 'nearby objects repel one another')
  document.hidden = true
  step(100)
  assert.equal(second.values.get('bootstrapX').value, position)
  document.hidden = false
  step(10000)
  assert.equal(second.values.get('bootstrapX').value, position)
  reduced.matches = true
  listeners.reduced()
  assert.equal(frames.size, 0)
  second.options.onLoad()
  assert.equal(classes.has('ready'), false)
  reduced.matches = false
  listeners.reduced()
  const third = instances[2]
  third.options.onLoadError()
  assert.equal(classes.has('fallback'), true, 'failed artwork shows a static fallback')
})
