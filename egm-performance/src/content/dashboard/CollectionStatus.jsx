import React from 'react'
import { collectionStatusLines } from './collection-status.mjs'

export function CollectionStatus({ refreshStatus }) {
  const sources = Array.isArray(refreshStatus?.sources) ? refreshStatus.sources : []
  if (!sources.length) return null
  const now = Date.now()
  return <section className="egm-collection-status" aria-label="Collection status">
    <h2>Collection status</h2>
    <ul>
      {sources.map(source => {
        const lines = collectionStatusLines(source, refreshStatus.collectionEndsAt, now)
        return <li key={source.id}><span>{source.label}</span><span>{lines.success}</span>{lines.reason && <span>{lines.reason}</span>}</li>
      })}
    </ul>
  </section>
}
