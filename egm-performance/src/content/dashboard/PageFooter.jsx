import React from 'react'
import {Icon} from '../../data-app-public.jsx'
import {CollectionStatus} from './CollectionStatus.jsx'

export function SiteFooter({generatedAt,refreshStatus}) {
  const timestamp=Date.parse(generatedAt)
  const updated=Number.isFinite(timestamp)?new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(timestamp)):null
  return <footer className="egm-site-footer">
    <div className="egm-footer-meta">{updated&&<span>Updated <time dateTime={generatedAt}>{updated}</time></span>}<CollectionStatus refreshStatus={refreshStatus}/></div>
    <nav aria-label="Project links"><a href="https://egm.dev" target="_blank" rel="noreferrer">egm.dev <Icon name="arrowUpRight" size={12}/></a><a href="https://github.com/google/elephant-goldfish-model" target="_blank" rel="noreferrer">GitHub <Icon name="arrowUpRight" size={12}/></a></nav>
  </footer>
}
