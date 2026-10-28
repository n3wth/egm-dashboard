const handoff = document.querySelector('.handoff')
const canvas = handoff?.querySelector('canvas')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const compact = window.matchMedia('(max-width: 600px)')
let animation
let loading = false
let active = true

function stop() {
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
        artboard: compact.matches ? 'Mobile' : 'Desktop',
        stateMachine: 'Handoff',
        autoplay: true,
        onLoad() {
          if (!active || reducedMotion.matches || animation !== instance) return
          instance.resizeDrawingSurfaceToCanvas()
          handoff.classList.add('ready')
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
compact.addEventListener('change', () => {
  stop()
  start()
})
window.addEventListener('resize', () => { if (handoff?.classList.contains('ready')) animation?.resizeDrawingSurfaceToCanvas() })
window.addEventListener('pagehide', () => {
  active = false
  stop()
})
window.addEventListener('pageshow', event => { if (event.persisted) { active = true; start() } })
start()
