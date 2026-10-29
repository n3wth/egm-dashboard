const handoff = document.querySelector('.handoff')
const canvas = handoff?.querySelector('canvas')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const portrait = window.matchMedia('(max-aspect-ratio: 4/5)')
let animation
let loading = false
let active = true
let frame
let updateMotionBounds

function move(instance, isPortrait) {
  const names = ['bootstrap', 'brainstorm', 'draft', 'resolve', 'drift', 'review', 'loop', 'elephant', 'goldfish']
  const portraitPositions = [[15, 12], [330, 20], [12, 180], [325, 180], [12, 385], [330, 385], [300, 540], [160, 115], [180, 490]]
  const model = instance.viewModelInstance
  // The desktop artboard draws its shapes larger than the portrait one, so collision sizes and edge margins follow.
  const margin = (portraitSize, desktopSize) => isPortrait ? portraitSize : desktopSize
  const bodies = names.map((name, index) => {
    const x = model?.number(`${name}X`), y = model?.number(`${name}Y`), rotation = model?.number(`${name}Rotation`)
    if (!x || !y || !rotation) throw new Error('Missing Rive motion binding')
    if (isPortrait) { x.value = portraitPositions[index][0]; y.value = portraitPositions[index][1]; rotation.value = 0 }
    const mark = index >= 7
    return { x, y, rotation, homeX: x.value, homeY: y.value, px: x.value, py: y.value, vx: 0, vy: 0, angle: 0, spin: 0, targetX: 0, targetY: 0, targetAngle: 0, next: 0, anchor: index < 4 ? 7 : index < 7 ? 8 : null, upper: index < 4 || index === 7, radius: mark ? (isPortrait ? 70 : 92) : (isPortrait ? 33 : 44), centerOffset: mark ? 0 : (isPortrait ? 25.2 : 33.6), minX: mark ? margin(85, 112) : 8, maxX: (isPortrait ? 400 : 800) - (mark ? margin(85, 112) : margin(58, 77)), minY: mark ? margin(85, 112) : 8, maxY: (isPortrait ? 600 : 400) - (mark ? margin(85, 112) : margin(58, 77)) }
  })
  updateMotionBounds = () => {
    if (!isPortrait) return
    const area = canvas.getBoundingClientRect()
    const content = document.querySelector('.login-content')?.getBoundingClientRect()
    if (!content || !area.width || !area.height) return
    const scale = Math.min(area.width / 400, area.height / 600)
    const top = area.top + (area.height - 600 * scale) / 2
    const overlaps = content.bottom > top && content.top < top + 600 * scale
    for (const body of bodies) {
      body.minY = body.radius === 70 ? 85 : 8
      body.maxY = 600 - (body.radius === 70 ? 85 : 58)
      if (overlaps && body.upper) body.maxY = Math.min(body.maxY, (content.top - 12 - top) / scale - body.centerOffset - body.radius)
      if (overlaps && !body.upper) body.minY = Math.max(body.minY, (content.bottom + 12 - top) / scale - body.centerOffset + body.radius)
      if (body.minY > body.maxY) throw new Error('Insufficient animation space')
      body.py = Math.max(body.minY, Math.min(body.maxY, body.py))
      body.y.value = body.py
    }
  }
  updateMotionBounds()
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
  updateMotionBounds = undefined
  const previous = animation
  animation = null
  handoff?.classList.remove('ready')
  previous?.cleanup()
}

function start() {
  if (!active || !canvas || reducedMotion.matches || animation || loading) return
  handoff.classList.remove('fallback')
  const initialize = () => {
    loading = false
    if (!active || reducedMotion.matches || !window.rive) return
    try {
      const isPortrait = portrait.matches
      window.rive.RuntimeLoader.setWasmUrl('/rive/rive.wasm')
      window.rive.RuntimeLoader.setWasmFallbackUrl(null)
      const instance = new window.rive.Rive({
        src: '/rive/egm-handoff.riv',
        canvas,
        artboard: isPortrait ? 'Portrait' : 'Desktop',
        stateMachine: 'Handoff',
        autoBind: true,
        autoplay: true,
        onLoad() {
          if (!active || reducedMotion.matches || animation !== instance) return
          try {
            instance.resizeDrawingSurfaceToCanvas()
            move(instance, isPortrait)
            handoff.classList.add('ready')
          } catch { stop(); handoff.classList.add('fallback') }
        },
        onLoadError() {
          if (animation === instance) {
            stop()
            handoff.classList.add('fallback')
          }
        },
      })
      animation = instance
    } catch {
      stop()
      handoff.classList.add('fallback')
    }
  }
  if (window.rive) return initialize()
  loading = true
  const script = document.createElement('script')
  script.src = '/rive/rive.js'
  script.onload = initialize
  script.onerror = () => { loading = false; handoff.classList.add('fallback') }
  document.head.append(script)
}

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    stop()
  } else start()
})
portrait.addEventListener('change', () => { stop(); start() })
window.addEventListener('resize', () => {
  if (!handoff?.classList.contains('ready')) return
  try { animation?.resizeDrawingSurfaceToCanvas(); updateMotionBounds?.() } catch { stop(); handoff.classList.add('fallback') }
})
window.addEventListener('pagehide', () => {
  active = false
  stop()
})
window.addEventListener('pageshow', event => { if (event.persisted) { active = true; start() } })
start()
