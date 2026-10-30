(() => {
  if (!window.gsap || !window.matchMedia) return
  const media = window.gsap.matchMedia()
  media.add('(prefers-reduced-motion: no-preference)', () => {
    window.gsap.from('.hero-line', {
      y: 18,
      opacity: 0.55,
      duration: 0.75,
      stagger: 0.09,
      ease: 'back.out(1.2)',
      clearProps: 'transform,opacity',
    })
  })
})()
