import React from 'react'
import {monotonePath, sparklineSegments} from './sparkline-path.mjs'
import {Hint} from '../../data-app-public.jsx'

// EGM card trendline: same geometry and gap handling as the shared MetricSparkline, drawn as a monotone curve.
export function TrendSparkline({values = [], label}) {
  const segments = sparklineSegments(values)
  if (!segments.length) return null
  return <Hint as="svg" title={label} tabIndex={label ? 0 : undefined} className="data-metric-sparkline egm-metric-sparkline" viewBox="0 0 58 25" preserveAspectRatio="none"
    role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true}>
    {segments.map((segment,index) => segment.length === 1
      ? <path key={index} d={`M${segment[0][0]},${segment[0][1]}h0`} fill="none" stroke="currentColor" strokeWidth="3.2"
        strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      : <path key={index} d={monotonePath(segment)} fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
  </Hint>
}
