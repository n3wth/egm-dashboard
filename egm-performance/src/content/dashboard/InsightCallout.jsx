import React from 'react'
import {Icon} from '../../data-app-public.jsx'
import './insight-callout.css'

/** One sentence computed from the reviewed rows. Recommendations live on the Research tab, where each is tied to its evidence. */
export function InsightCallout({children}) {
  return <aside className="egm-insight-callout" aria-label="Insight">
    <Icon name="lightbulb" size={18}/>
    <p>{children}</p>
  </aside>
}
