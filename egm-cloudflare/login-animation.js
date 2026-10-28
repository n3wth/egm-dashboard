const handoff = document.querySelector('.handoff')
const canvas = handoff?.querySelector('canvas')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
let animation
let loading = false
let active = true
let frame

function move(instance) {
  const names = ['bootstrap', 'brainstorm', 'draft', 'resolve', 'drift', 'review', 'loop', 'elephant', 'goldfish']
  const model = instance.viewModelInstance
  const bodies = names.map((name, index) => {
    const x = model?.number(`${name}X`), y = model?.number(`${name}Y`), rotation = model?.number(`${name}Rotation`)
    if (!x || !y || !rotation) throw new Error('Missing Rive motion binding')
    const mark = index >= 7
    return { x, y, rotation, homeX: x.value, homeY: y.value, px: x.value, py: y.value, vx: 0, vy: 0, angle: 0, spin: 0, targetX: 0, targetY: 0, targetAngle: 0, next: 0, anchor: index < 4 ? 7 : index < 7 ? 8 : null, radius: mark ? 70 : 25, centerOffset: mark ? 0 : 19.2, minX: mark ? 85 : 4, maxX: mark ? 515 : 556, minY: mark ? 85 : 4, maxY: mark ? 315 : 356 }
  })
  let last
  function tick(time) {
    if (animation !== instance || !active || reducedMotion.matches) return
    if (document.hidden) { last = undefined; frame = requestAnimationFrame(tick); return }
    const dt = Math.min((time - (last ?? time)) / 1000, 0.05)
    last = time
    for (const body of bodies) {
      if (time >= body.next) {
        body.targetX = (Math.random() - 0.5) * 24
        body.targetY = (Math.random() - 0.5) * 24
        body.targetAngle = (Math.random() - 0.5) * 0.3
        body.next = time + 1500 + Math.random() * 2500
      }
      const anchor = bodies[body.anchor]
      const offsetX = anchor ? (anchor.px - anchor.homeX) * 0.35 : 0
      const offsetY = anchor ? (anchor.py - anchor.homeY) * 0.35 : 0
      let fx = (body.homeX + body.targetX + offsetX - body.px) * 0.8
      let fy = (body.homeY + body.targetY + offsetY - body.py) * 0.8
      for (const other of bodies) {
        if (body === other) continue
        const dx = body.px + body.centerOffset - other.px - other.centerOffset, dy = body.py + body.centerOffset - other.py - other.centerOffset
        const distance = Math.hypot(dx, dy) || 1
        const separation = body.radius + other.radius
        if (distance < separation) { fx += dx / distance * (separation - distance) * 1.5; fy += dy / distance * (separation - distance) * 1.5 }
      }
      const damping = Math.exp(-1.8 * dt)
      body.vx = (body.vx + fx * dt) * damping
      body.vy = (body.vy + fy * dt) * damping
      body.spin = (body.spin + (body.targetAngle - body.angle) * dt) * damping
      body.px += body.vx * dt
      body.py += body.vy * dt
      if (body.px < body.minX || body.px > body.maxX) { body.px = Math.max(body.minX, Math.min(body.maxX, body.px)); body.vx = 0 }
      if (body.py < body.minY || body.py > body.maxY) { body.py = Math.max(body.minY, Math.min(body.maxY, body.py)); body.vy = 0 }
      body.angle += body.spin * dt
      body.x.value = body.px
      body.y.value = body.py
      body.rotation.value = body.angle
    }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
}

function stop() {
  cancelAnimationFrame(frame)
  frame = undefined
  const previous = animation
  animation = null
  handoff?.classList.remove('ready')
  previous?.cleanup()
}

function start() {
  if (!active || !canvas || reducedMotion.matches || animation || loading) return
  const initialize = () => {
    loading = false
    if (!active || reducedMotion.matches || !window.rive) return
    try {
      window.rive.RuntimeLoader.setWasmUrl('/rive/rive.wasm')
      window.rive.RuntimeLoader.setWasmFallbackUrl(null)
      const instance = new window.rive.Rive({
        src: '/rive/egm-handoff.riv',
        canvas,
        artboard: 'Desktop',
        stateMachine: 'Handoff',
        autoBind: true,
        autoplay: true,
        onLoad() {
          if (!active || reducedMotion.matches || animation !== instance) return
          try {
            instance.resizeDrawingSurfaceToCanvas()
            move(instance)
            handoff.classList.add('ready')
          } catch { stop() }
        },
        onLoadError() {
          if (animation === instance) handoff.classList.remove('ready')
        },
      })
      animation = instance
    } catch {
      handoff.classList.remove('ready')
    }
  }
  if (window.rive) return initialize()
  loading = true
  const script = document.createElement('script')
  script.src = '/rive/rive.js'
  script.onload = initialize
  script.onerror = () => { loading = false }
  document.head.append(script)
}

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    stop()
  } else start()
})
window.addEventListener('resize', () => { if (handoff?.classList.contains('ready')) animation?.resizeDrawingSurfaceToCanvas() })
window.addEventListener('pagehide', () => {
  active = false
  stop()
})
window.addEventListener('pageshow', event => { if (event.persisted) { active = true; start() } })
start()
