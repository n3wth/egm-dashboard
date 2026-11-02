import React, {cloneElement, useEffect, useId, useLayoutEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {navTooltipPosition} from './nav-tooltip-position.mjs'
import './nav-tooltip.css'

export function NavTooltip({label, children, className = '', ...props}) {
  const id = useId()
  const anchor = useRef(null)
  const tip = useRef(null)
  const timer = useRef(null)
  const [visible, setVisible] = useState(false)
  const hide = () => { clearTimeout(timer.current); setVisible(false) }
  useEffect(() => () => clearTimeout(timer.current), [])
  useLayoutEffect(() => {
    if (!visible) return undefined
    const position = () => {
      const bounds = navTooltipPosition(anchor.current.getBoundingClientRect(), tip.current.getBoundingClientRect(), {width: window.innerWidth, height: window.innerHeight})
      Object.assign(tip.current.style, {left: `${bounds.left}px`, top: `${bounds.top}px`, visibility: 'visible'})
    }
    const escape = event => { if (event.key === 'Escape') hide() }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', hide, true)
    document.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', hide, true)
      document.removeEventListener('keydown', escape)
    }
  }, [visible, label])
  return <span {...props} ref={anchor} className={`egm-nav-tooltip-trigger ${className}`} onPointerEnter={event => {
    if (event.pointerType === 'touch' || anchor.current.querySelector('[data-state="open"]')) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(true), 500)
  }} onPointerLeave={hide} onFocus={event => {
    if (event.target.matches(':focus-visible')) { clearTimeout(timer.current); setVisible(true) }
  }} onBlur={hide} onPointerDown={hide} onClick={hide}>
    {cloneElement(children, {'aria-describedby': visible ? id : children.props['aria-describedby']})}
    {visible && createPortal(<span ref={tip} id={id} role="tooltip" className="egm-nav-tooltip">{label}</span>, document.body)}
  </span>
}
