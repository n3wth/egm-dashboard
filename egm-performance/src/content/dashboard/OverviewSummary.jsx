import React from 'react'
import {overviewSummary} from './overview-summary.mjs'
import {DashHero} from './DashHero.jsx'
import {analysisSummary} from './saved-analysis.mjs'

export function OverviewSummary({queries}) {
  return <DashHero id="overview-summary" title="Overview" headingId="overview-heading" summary={analysisSummary(overviewSummary(queries),queries,'overview')} queries={queries}/>
}
