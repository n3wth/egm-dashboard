import React, { useState } from 'react'
import {Button, Icon} from '../../data-app-public.jsx'
import {PageLink} from './PageLink.jsx'
import {navbarIcon} from './navbar-icons.mjs'
import {pages} from './pages.mjs'
import {dismissWelcome, welcomeDismissed} from './welcome.mjs'

const storage = () => { try { return globalThis.localStorage } catch { return undefined } }

export function Welcome() {
  const [open,setOpen]=useState(()=>!welcomeDismissed(storage()))
  if(!open)return null
  const close=()=>{dismissWelcome(storage());setOpen(false)}
  return <section className="egm-welcome" aria-labelledby="egm-welcome-title">
    <div className="egm-welcome-header">
      <h2 id="egm-welcome-title">New here? How to read this dashboard</h2>
      <Button variant="ghost" className="egm-welcome-close" aria-label="Dismiss introduction" onClick={close}><Icon name="close" size={16}/></Button>
    </div>
    <p className="egm-welcome-lede">It tracks how people find, try and talk about EGM, using GitHub traffic for the google/elephant-goldfish-model repo, egm.dev referrals, the issue queue and public mentions.</p>
    <ul className="egm-welcome-notes">
      <li><strong>Two-week window.</strong> GitHub keeps only 14 days of traffic, so views, visitors and clones cover that window. Stars, issues and PRs are current totals.</li>
      <li><strong>Top ten referrers.</strong> GitHub names only its top ten traffic sources; anything else is unattributed.</li>
      <li><strong>Definitions.</strong> The info icon on every card says exactly what it counts and what it leaves out.</li>
    </ul>
    <div className="egm-welcome-pages">
      {pages.filter(page=>page.id!=='reach').map(page=><PageLink key={page.id} className="egm-welcome-page" page={page.id}>
        <Icon name={navbarIcon(page.id)} size={20}/>
        <span><span className="egm-welcome-page-title">{page.label}</span><span className="egm-welcome-page-summary">{page.summary}</span></span>
      </PageLink>)}
    </div>
    <Button className="egm-welcome-done" onClick={close}>Got it</Button>
  </section>
}
