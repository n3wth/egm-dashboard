import React from 'react'
import {staleness} from './states.mjs'

export function EmptyState({title='No data yet',children='The latest snapshot has no rows here. Check back after the next refresh.',chart=false}) {
  return <div className={`egm-empty${chart?' egm-empty--chart':''}`} role="status"><strong>{title}</strong><span>{children}</span></div>
}

export function StaleNotice({generatedAt}) {
  const stale=staleness(generatedAt)
  if(!stale)return null
  return <p className="egm-stale" role="status">Data last refreshed {stale.label}. Figures may be out of date. Use Refresh data in the top bar to check for newer data.</p>
}
