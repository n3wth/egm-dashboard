import React from 'react'
import {Icon} from '../../data-app-public.jsx'
import {PageLink} from './PageLink.jsx'
import {adjacentPages} from './pages.mjs'

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
