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

test('Ask keeps an active request open on outside interaction and announces completion', async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const { shouldDismissAsk, AskCompletion, LiveMetricCard } = await server.ssrLoadModule('/src/content/dashboard/AskPanel.jsx')
    assert.equal(shouldDismissAsk(true), false)
    assert.equal(shouldDismissAsk(false), true)
    assert.match(renderToStaticMarkup(React.createElement(AskCompletion, { status: 'streaming' })), /role="status"[^>]*><\/span>/)
    assert.match(renderToStaticMarkup(React.createElement(AskCompletion, { status: 'complete' })), /role="status"[^>]*>Answer complete/)
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(LiveMetricCard, { card: { title: 'Test', observedAt: 'invalid', metrics: [] } })), /Invalid Date/)
  } finally { await server.close() }
})
