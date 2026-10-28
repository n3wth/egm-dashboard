import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('live GitHub metrics render without a saved snapshot query', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { LiveMetricCard } = await server.ssrLoadModule('/src/content/dashboard/AskPanel.jsx')
    const html = renderToStaticMarkup(React.createElement(LiveMetricCard, { card: { title: 'EGM right now', sourceId: 'S1', metrics: [{ label: 'Stars', value: 1234 }] } }))
    assert.match(html, /EGM right now/)
    assert.match(html, /1,234/)
    assert.match(html, /\[S1\]/)
  } finally { await server.close() }
})
