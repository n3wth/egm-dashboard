import React from 'react'
import {Icon} from '../../data-app-public.jsx'
import './insight-callout.css'

export function InsightCallout({children,action}) {
  return <aside className="egm-insight-callout" aria-label="Insight">
    <Icon name="lightbulb" size={18}/>
    <div><p>{children}</p>{action&&<p className="egm-insight-action"><strong>Try:</strong> {action}</p>}</div>
  </aside>
}
