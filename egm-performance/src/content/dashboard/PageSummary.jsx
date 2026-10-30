import React from 'react'
import {pageSummary} from './page-summary.mjs'
import {DashHero} from './DashHero.jsx'

const titles = {acquisition: 'Acquisition', adoption: 'Adoption', website: 'Website', development: 'Development', research: 'Research', mentions: 'Mentions'}

export function PageSummary({page, queries}) {
  const title = titles[page] ?? page
  return <DashHero id={`${page}-summary`} title={title} headingId={`${page}-summary-heading`} summary={pageSummary(page, queries)} queries={queries}/>
}
