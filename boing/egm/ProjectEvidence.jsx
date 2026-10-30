import React from 'react'
import { EvidenceChart, MetricCard, Section } from '../egm-performance/src/data-app-public.jsx'
import { projectEvidence } from './model.mjs'

// Read-only public components, not the protected hosted shell. The parent
// application must establish identity, verify WorkOS membership, and associate
// the response with a server-authorized tenant and project before rendering.
export function ProjectEvidence({ organizationId, projectId, snapshot }) {
  const evidence = projectEvidence({ organizationId, projectId, snapshot })
  const format = value => value === null ? 'Unavailable' : value.toLocaleString('en-US')
  return <div aria-label="Project evidence">
    <p>Source: GitHub · {evidence.generatedAt ? `Collected ${new Date(evidence.generatedAt).toLocaleString()}` : 'Collection time unavailable'}</p>
    <Section columns={3} spacing="none">
      {evidence.metrics.map(metric => <MetricCard key={metric.id} id={`project-${metric.id}`}
        queryId="reach" title={metric.title} value={format(metric.value)}
        canEdit={false} displayRows={[]} />)}
    </Section>
    {evidence.traffic.length > 0 && <Section id="project-views-heading" title="Daily repository views">
      <EvidenceChart id="project-views-history" queryId="traffic" title="Daily repository views"
        canEdit={false} rows={evidence.traffic} sourceRows={evidence.traffic}
        spec={{ type: 'line', x: 'date', y: 'views', fields: ['views'], colors: { views: 'var(--chart-1)' }, startAtZero: true }} />
    </Section>}
  </div>
}
