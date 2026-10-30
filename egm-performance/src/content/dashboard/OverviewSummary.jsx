import React from 'react'
import {overviewSummary} from './overview-summary.mjs'
import {DashHero} from './DashHero.jsx'

export function OverviewSummary({queries}) {
  return <DashHero id="overview-summary" title="Overview" headingId="overview-heading" summary={overviewSummary(queries)} queries={queries}/>
}
