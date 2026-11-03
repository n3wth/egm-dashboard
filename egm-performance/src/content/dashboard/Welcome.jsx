import React, { useRef,useState } from 'react'
import {Button, Icon} from '../../data-app-public.jsx'
import {PageLink} from './PageLink.jsx'
import {navbarIcon} from './navbar-icons.mjs'
import {pages} from './pages.mjs'
import {dismissWelcome} from './welcome.mjs'

const storage = () => { try { return globalThis.localStorage } catch { return undefined } }

export function Welcome() {
  const summary=useRef(null)
  const [open,setOpen]=useState(false)
  const close=()=>{dismissWelcome(storage());setOpen(false);summary.current?.focus()}
  return <details className="egm-welcome" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary ref={summary}>How to read this dashboard</summary>
    <p className="egm-welcome-lede">It tracks how people find, try and talk about EGM, using GitHub traffic for the google/elephant-goldfish-model repo, egm.dev referrals, the issue queue and public mentions.</p>
    <ul className="egm-welcome-notes">
      <li><strong>Two-week totals.</strong> GitHub keeps only 14 days of traffic, so headline views, visitors and clones cover that window. The daily charts keep every day collected since Oct 13; pick a date range on the chart. Stars, issues and PRs are current totals.</li>
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
  </details>
}
