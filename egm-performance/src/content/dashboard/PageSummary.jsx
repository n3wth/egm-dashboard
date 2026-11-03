import React from 'react'
import {pageSummary} from './page-summary.mjs'
import {DashHero} from './DashHero.jsx'
import {analysisSummary} from './saved-analysis.mjs'

const titles = {acquisition: 'Acquisition', adoption: 'Adoption', website: 'Website', development: 'Development', research: 'Research', mentions: 'Mentions'}

export function PageSummary({page, queries}) {
  const title = titles[page] ?? page
  return <DashHero id={`${page}-summary`} title={title} headingId={`${page}-summary-heading`} summary={analysisSummary(pageSummary(page,queries),queries,page)} queries={queries}/>
}
