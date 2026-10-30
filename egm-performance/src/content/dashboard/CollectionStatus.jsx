import React from 'react'
import { collectionStatusLines, collectionSummary } from './collection-status.mjs'

export function CollectionStatus({ refreshStatus }) {
  const sources = Array.isArray(refreshStatus?.sources) ? refreshStatus.sources : []
  if (!sources.length) return null
  const now = Date.now()
  const summary = collectionSummary(sources, refreshStatus.collectionEndsAt, now)
  return <details className="egm-collection-status">
    <summary>
      <span className="egm-collection-title">Collection status</span>
      <span className="egm-collection-summary">{summary.label}</span>
    </summary>
    <ul>
      {sources.map(source => {
        const lines = collectionStatusLines(source, refreshStatus.collectionEndsAt, now)
        return <li key={source.id}>
          <span className="egm-collection-name">{source.label}</span>
          <span className="egm-collection-time">{lines.success}</span>
          {lines.reason && <span className="egm-collection-state">{lines.reason}</span>}
        </li>
      })}
    </ul>
  </details>
}
