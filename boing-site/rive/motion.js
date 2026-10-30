(() => {
  const canvas = document.getElementById('momentum')
  const container = canvas?.parentElement
  const context = canvas?.getContext('2d')
  const caption = document.querySelector('.hero-caption')
  if (!context || !container || !window.matchMedia) return

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const colors = ['#2476f9', '#8e35f5', '#ff4c89', '#ffad25', '#44ce70']
  let width = 0
  let height = 0
  let frame = 0
  let last = 0
  let particles = []

  const random = (min, max) => min + Math.random() * (max - min)
  const makeParticle = (progress = 0) => ({
    progress,
    speed: random(.055, .085),
    startY: random(.68, .96),
    endY: random(.06, .34),
    bend: random(.1, .32),
    radius: random(.035, .065),
    color: Math.floor(random(0, colors.length)),
  })

  function resize() {
    const bounds = container.getBoundingClientRect()
    width = bounds.width
    height = bounds.height
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(height * ratio))
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
  }

  function position(particle, t) {
    const x = -.06 + 1.12 * t
    const y = particle.startY + (particle.endY - particle.startY) * t + particle.bend * Math.sin(Math.PI * t)
    return [x * width, y * height]
  }

  function draw(time) {
    if (!last) last = time
    const delta = Math.min((time - last) / 1000, .05)
    last = time
    context.clearRect(0, 0, width, height)
    particles.forEach((particle, index) => {
      particle.progress += delta * particle.speed
      if (particle.progress > 1.08) particles[index] = particle = makeParticle(-random(.08, .25))
      const t = particle.progress
      if (t < 0 || t > 1) return
      const alpha = Math.min(1, t * 9, (1 - t) * 9)
      for (let i = 18; i > 0; i--) {
        const from = Math.max(0, t - i * .012)
        const to = Math.max(0, t - (i - 1) * .012)
        if (from === to) continue
        const [x1, y1] = position(particle, from)
        const [x2, y2] = position(particle, to)
        context.globalAlpha = alpha * (1 - i / 19) * .48
        context.strokeStyle = colors[particle.color]
        context.lineWidth = Math.max(2, Math.min(width, height) * particle.radius * .55)
        context.lineCap = 'round'
        context.beginPath()
        context.moveTo(x1, y1)
        context.lineTo(x2, y2)
        context.stroke()
      }
      for (let i = 5; i >= 0; i--) {
        const trail = t - i * .018
        if (trail < 0) continue
        const [x, y] = position(particle, trail)
        const radius = Math.min(width, height) * particle.radius * (1 - i * .13)
        context.globalAlpha = alpha * (i ? .13 + (5 - i) * .045 : 1)
        context.fillStyle = colors[(particle.color + i) % colors.length]
        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.fill()
      }
    })
    context.globalAlpha = 1
    if (caption) {
      const bounds = container.getBoundingClientRect()
      const text = caption.getBoundingClientRect()
      context.clearRect(text.left - bounds.left - 16, text.top - bounds.top - 16, text.width + 32, text.height + 32)
    }
    frame = requestAnimationFrame(draw)
  }

  function stop() {
    cancelAnimationFrame(frame)
    frame = 0
    last = 0
    container.classList.remove('is-playing')
  }

  function start() {
    if (reduced.matches || document.hidden || frame) return
    resize()
    particles = [makeParticle(.12), makeParticle(.43), makeParticle(.75)]
    container.classList.add('is-playing')
    frame = requestAnimationFrame(draw)
  }

  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start())
  reduced.addEventListener?.('change', () => reduced.matches ? stop() : start())
  start()
})()
