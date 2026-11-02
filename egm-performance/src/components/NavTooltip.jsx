import React, {cloneElement, useEffect, useId, useLayoutEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {navTooltipPosition} from './nav-tooltip-position.mjs'
import './nav-tooltip.css'

export function NavTooltip({label, children, className = '', asChild = false, ...props}) {
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
  const events = {onPointerEnter: event => {
    if (event.pointerType === 'touch' || anchor.current.querySelector('[data-state="open"]')) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(true), 500)
  }, onPointerLeave:()=>{clearTimeout(timer.current);timer.current=setTimeout(hide,200)}, onFocus:event => {
    if (event.target.matches(':focus-visible')) { clearTimeout(timer.current); setVisible(true) }
  }, onBlur:hide, onPointerDown:hide, onClick:hide}
  const describedBy = [children.props['aria-describedby'],visible ? id : null].filter(Boolean).join(' ') || undefined
  const trigger = asChild ? cloneElement(children, {
    ...Object.fromEntries(Object.entries(events).map(([name,handler])=>[name,event=>{children.props[name]?.(event);handler(event)}])),
    ref:element=>{anchor.current=element;const ref=children.props.ref;if(typeof ref==='function')ref(element);else if(ref)ref.current=element},
    'aria-describedby':describedBy
  }) : <span {...props} {...events} ref={anchor} className={`egm-nav-tooltip-trigger ${className}`}>
    {cloneElement(children, {'aria-describedby':describedBy})}
  </span>
  return <>{trigger}{visible && label && createPortal(<span ref={tip} id={id} role="tooltip" className="egm-nav-tooltip" onPointerEnter={()=>clearTimeout(timer.current)} onPointerLeave={hide}>{label}</span>, document.body)}</>
}

export function Hint({as:Tag='span',title,children,...props}) {
  const passive=['span','p','time','h3','div'].includes(Tag)
  const element=<Tag {...props} tabIndex={props.tabIndex??(title&&passive?0:undefined)}>{children}</Tag>
  return title?<NavTooltip label={title} asChild>{element}</NavTooltip>:element
}
