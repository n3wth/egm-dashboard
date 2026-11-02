import React from 'react'
import {Icon} from '../../data-app-public.jsx'
import {PageLink} from './PageLink.jsx'
import {adjacentPages} from './pages.mjs'
import {CollectionStatus} from './CollectionStatus.jsx'

export function SiteFooter({generatedAt,refreshStatus}) {
  const timestamp=Date.parse(generatedAt)
  const updated=Number.isFinite(timestamp)?new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(timestamp)):null
  return <footer className="egm-site-footer">
    <div><span className="egm-site-footer-name">EGM dashboard</span>{updated&&<span>Updated <time dateTime={generatedAt}>{updated}</time></span>}</div>
    <nav aria-label="Project links"><a href="https://egm.dev" target="_blank" rel="noreferrer">egm.dev <Icon name="arrowUpRight" size={12}/></a><a href="https://github.com/google/elephant-goldfish-model" target="_blank" rel="noreferrer">GitHub <Icon name="arrowUpRight" size={12}/></a><a href="#data-app-main">Back to top <Icon name="arrowUp" size={12}/></a></nav>
    <CollectionStatus refreshStatus={refreshStatus}/>
  </footer>
}

function FooterLink({page,direction}) {
  return <PageLink className={`egm-page-footer-link egm-page-footer-link--${direction}`} page={page.id}>
    {direction==='previous'&&<Icon name="chevronLeft" size={16}/>}
    <span className="egm-page-footer-text">
      <span className="egm-page-footer-label">{direction==='previous'?'Previous':'Next'}</span>
      <span className="egm-page-footer-title">{page.label}</span>
      <span className="egm-page-footer-summary">{page.summary}</span>
    </span>
    {direction==='next'&&<Icon name="chevronRight" size={16}/>}
  </PageLink>
}

export function PageFooter({page}) {
  const {previous,next}=adjacentPages(page)
  if(!previous&&!next)return null
  return <section className="egm-page-footer" aria-label="Other dashboard pages">
    {previous?<FooterLink page={previous} direction="previous"/>:<span aria-hidden="true"/>}
    {next&&<FooterLink page={next} direction="next"/>}
  </section>
}
