import React from 'react'
import {Icon} from '../../data-app-public.jsx'
import {engagementSignals} from './engagement-signals.mjs'

const compact=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1})
const paths={likes:'M12 20s-8-4.8-8-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.2-8 10-8 10Z',reactions:'M8 14h-4v7h4m0-7 4-10c2 0 3 2 2 5l-1 3h5a2 2 0 0 1 2 2l-1 5a2 2 0 0 1-2 2h-9V14Z',reposts:'m16 3 4 4-4 4M4 7h16M8 21l-4-4 4-4m12 4H4'}
export function EngagementSignals({row}) {
  const signals=engagementSignals(row)
  if(!signals.length)return null
  return <span style={{display:'inline-flex',alignItems:'center',flexWrap:'wrap',gap:12,color:'var(--secondary)'}}>{signals.map(signal=>{
    const title=`${signal.value.toLocaleString('en-US')} ${signal.label.toLowerCase()}. Observed ${new Date(signal.observedAt).toLocaleString('en-US',{timeZone:'America/Los_Angeles',timeZoneName:'short'})}${signal.source?' · '+signal.source:''}`
    return <span key={signal.kind} title={title} aria-label={title} style={{display:'inline-flex',alignItems:'center',gap:4,fontVariantNumeric:'tabular-nums'}}>{paths[signal.kind]?<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[signal.kind]}/></svg>:<Icon name={signal.kind==='views'?'eye':signal.kind==='points'?'arrowUp':'chatBubble'} size={13}/>}<span>{compact.format(signal.value)}</span></span>
  })}</span>
}
