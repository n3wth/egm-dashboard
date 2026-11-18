import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import {ANALYSIS_QUESTION, analyzeObservedStars} from '../src/content/dashboard/ask-analysis.mjs'
import {startersFor} from '../src/content/dashboard/ask-starters.mjs'

const calculation = {
  id: 'observed-net-stars-7d', status: 'complete',
  definition: 'Net change in observed repository star totals.',
  timeZone: 'America/Los_Angeles', observedAt: '2026-11-18T15:00:00.000Z',
  availableRange: {startDate: '2026-11-03', endDate: '2026-11-18'}, reason: null,
  boundaries: [
    {label: 'Previous start', date: '2026-11-03', observedAt: '2026-11-03T16:12:00.000Z', stars: 1000},
    {label: 'Period boundary', date: '2026-11-10', observedAt: '2026-11-10T15:08:00.000Z', stars: 1070},
    {label: 'Latest end', date: '2026-11-17', observedAt: '2026-11-17T15:09:00.000Z', stars: 1042},
  ],
  previous: 70, current: -28, difference: -98,
}
const card = {
  type: 'chart', calculated: true, queryId: 'star_observations', sourceId: '1',
  title: 'Observed daily net stars', observedAt: calculation.observedAt,
  xKey: 'date', series: ['netStars'], seriesLabels: {netStars: 'Net stars'},
  rows: Array.from({length: 14}, (_, i) => ({date: `2026-11-${String(i + 4).padStart(2, '0')}`, netStars: i < 7 ? 10 : -4})),
}

test('matching calculated charts use reviewed evidence wrappers and standard chart actions', async () => {
  const server = await createServer({server: {middlewareMode: true}, logLevel: 'silent'})
  try {
    const {AnswerCard} = await server.ssrLoadModule('/src/content/dashboard/AskPanel.jsx')
    const {DataAppContext} = await server.ssrLoadModule('/src/DataAppContext.jsx')
    const id = 'ask-result-comparison-0-star_observations'
    const query = {source: {executedAt: '2026-11-18T07:00:00-08:00'}, rows: [{date: '2026-11-17', stars: 1042}]}
    let component
    const value = {
      snapshot: {surface: 'dashboard'}, queries: {star_observations: query},
      visible: componentId => { assert.equal(componentId, id); return true },
      chartProps: componentId => { assert.equal(componentId, id); return {} },
      componentActions: {
        canEdit: true, onOpen() {}, onCopy() {}, onRegisterComponent() {},
        additionalActions: metadata => { component = metadata; return null },
      },
    }
    const render = (overrides = {}, resultCard = card) => renderToStaticMarkup(React.createElement(DataAppContext.Provider, {value: {...value, ...overrides}}, React.createElement(AnswerCard, {card: resultCard, index: 0, turnId: 'comparison'})))
    const html = render()
    assert.match(html, new RegExp(`data-component-id="${id}"`))
    assert.match(html, /data-query-id="star_observations"/)
    assert.match(html, /data-component-kind="chart"/)
    assert.match(html, /chart-frame/)
    assert.match(html, /href="#ask-cite-comparison-1"/)
    for (const action of ['Edit chart', 'View data source', 'Copy data']) assert.ok(html.includes(action))
    assert.equal(component.id, id)
    assert.equal(component.queryId, 'star_observations')
    assert.equal(component.sourceRows, query.rows)
    assert.equal(component.displayRows, card.rows)
    assert.equal(component.chart.type, 'line')
    assert.equal(component.chart.x, 'date')
    assert.deepEqual(component.chart.fields, ['netStars'])
    assert.equal(component.chart.legend.labels.netStars, 'Net stars')
    render({chartOverrides: {[id]: {type: 'bar', x: 'date', y: 'netStars', fields: ['netStars']}}})
    assert.equal(component.chart.type, 'bar')
    assert.equal(component.sourceRows, query.rows)
    assert.equal(component.displayRows, card.rows)
    assert.equal(render({visible: () => false}), '')
    assert.match(render({}, {...card, calculated: false}), /data-component-kind="chart"/)
    assert.equal(render({queries: {}}, {...card, calculated: false}), '')
    assert.equal(render({queries: {}}, {...card, type: 'metric', calculated: false, metrics: [{label: 'Stars', value: 1234}]}).includes('1,234'), true)
  } finally { await server.close() }
})

test('unmatched calculated charts disclose unavailable visuals and preserve exact server calculations', async () => {
  const server = await createServer({server: {middlewareMode: true}, logLevel: 'silent'})
  try {
    const {AnswerCard, CalculationDetails} = await server.ssrLoadModule('/src/content/dashboard/AskPanel.jsx')
    const {DataAppContext} = await server.ssrLoadModule('/src/DataAppContext.jsx')
    const cases = [
      ['missing query', undefined, card.observedAt],
      ['older query', '2026-11-18T14:00:00.000Z', card.observedAt],
      ['newer query', '2026-11-18T16:00:00.000Z', card.observedAt],
      ['invalid query timestamp', 'invalid', card.observedAt],
      ['missing query timestamp', null, card.observedAt],
      ['invalid card timestamp', card.observedAt, 'invalid'],
      ['missing card timestamp', card.observedAt, null],
      ['both timestamps invalid', 'invalid', 'invalid'],
    ]
    for (const [label, executedAt, observedAt] of cases) {
      const value = {
        snapshot: {surface: 'dashboard'},
        queries: executedAt === undefined ? {} : {star_observations: {source: {executedAt}, rows: [{stars: 999999}]}},
        visible: () => assert.fail('Unavailable charts must not mount evidence wrappers'),
        componentActions: {},
      }
      const html = renderToStaticMarkup(React.createElement(DataAppContext.Provider, {value},
        React.createElement(React.Fragment, null,
          React.createElement(AnswerCard, {card: {...card, observedAt}, index: 0, turnId: 'comparison'}),
          React.createElement(CalculationDetails, {calculation}))))
      assert.match(html, /<h3>Observed daily net stars<\/h3>/, label)
      assert.match(html, /Chart unavailable for this dashboard snapshot\. See calculation details\./, label)
      assert.match(html, /href="#ask-cite-comparison-1"/, label)
      assert.doesNotMatch(html, /chart-frame|data-component-id|Edit chart|View data source|999999|Invalid Date/, label)
      assert.match(html, /How calculated/, label)
      assert.match(html, /1,070 − 1,000 = 70 net stars/, label)
      assert.match(html, /1,042 − 1,070 = -28 net stars/, label)
      assert.match(html, /-28 − \(70\) = -98 stars/, label)
      assert.ok(html.includes(calculation.observedAt), label)
    }
  } finally { await server.close() }
})

test('calculation disclosure exposes exact boundaries and signed subtraction', async () => {
  const server = await createServer({server: {middlewareMode: true}, logLevel: 'silent'})
  try {
    const {CalculationDetails} = await server.ssrLoadModule('/src/content/dashboard/AskPanel.jsx')
    const html = renderToStaticMarkup(React.createElement(CalculationDetails, {calculation}))
    assert.match(html, /<details class="egm-ask-calculation"><summary>How calculated<\/summary>/)
    assert.doesNotMatch(html, /<details[^>]*\bopen\b/)
    for (const boundary of calculation.boundaries) {
      assert.ok(html.includes(boundary.label))
      assert.ok(html.includes(boundary.date))
      assert.ok(html.includes(boundary.observedAt))
      assert.ok(html.includes(`${boundary.stars.toLocaleString('en-US')} total stars`))
    }
    assert.match(html, /America\/Los_Angeles/)
    assert.ok(html.includes(calculation.definition))
    assert.ok(html.includes(calculation.observedAt))
    assert.match(html, /2026-11-03 to 2026-11-18/)
    assert.match(html, /1,070 − 1,000 = 70 net stars/)
    assert.match(html, /1,042 − 1,070 = -28 net stars/)
    assert.match(html, /-28 − \(70\) = -98 stars/)
    assert.match(html, /Observation times vary/)
    assert.match(html, /latest source sampling day is excluded/)
    assert.match(html, /reconstructed new stars from current stargazers/)
    assert.doesNotMatch(html, /Invalid Date|%/)
    const positive = renderToStaticMarkup(React.createElement(CalculationDetails, {calculation: {...calculation, difference: 98}}))
    assert.match(positive, /= \+98 stars/)
  } finally { await server.close() }
})

test('unavailable calculations show reason and range without fabricated zero comparisons', async () => {
  const server = await createServer({server: {middlewareMode: true}, logLevel: 'silent'})
  try {
    const {CalculationDetails} = await server.ssrLoadModule('/src/content/dashboard/AskPanel.jsx')
    const unavailable = {status: 'unavailable', definition: 'Observed net stars', timeZone: 'America/Los_Angeles', observedAt: 'invalid', availableRange: {startDate: '2026-11-16', endDate: '2026-11-18'}, reason: 'Not enough consecutive closed samples.', boundaries: []}
    const html = renderToStaticMarkup(React.createElement(CalculationDetails, {calculation: unavailable}))
    assert.match(html, /Not enough consecutive closed samples/)
    assert.match(html, /2026-11-16 to 2026-11-18/)
    assert.doesNotMatch(html, /Invalid Date|0 stars|Latest minus previous|Previous start/)
    assert.equal(renderToStaticMarkup(React.createElement(CalculationDetails, {})), '')
    const absentRange = renderToStaticMarkup(React.createElement(CalculationDetails, {calculation: {...unavailable, observedAt: null, availableRange: null}}))
    assert.match(absentRange, /Available sampling dates<\/dt><dd>Unavailable/)
  } finally { await server.close() }
})

test('Overview starter and disclosure match the deterministic calculation output', async () => {
  assert.equal(startersFor('reach').questions[1], ANALYSIS_QUESTION)
  const query = {
    source: {executedAt: calculation.observedAt},
    rows: Array.from({length: 16}, (_, i) => ({date: `2026-11-${String(i + 3).padStart(2, '0')}`, observedAt: `2026-11-${String(i + 3).padStart(2, '0')}T15:00:00.000Z`, stars: i <= 7 ? 1000 + i * 10 : 1070 - (i - 7) * 4})),
  }
  const result = analyzeObservedStars(query, Date.parse('2026-11-18T16:00:00.000Z'))
  assert.equal(result.calculation.status, 'complete')
  assert.equal(result.rows.length, 14)
  assert.equal(result.rows.slice(0, 7).reduce((sum, row) => sum + row.netStars, 0), result.calculation.previous)
  assert.equal(result.rows.slice(7).reduce((sum, row) => sum + row.netStars, 0), result.calculation.current)
  const server = await createServer({server: {middlewareMode: true}, logLevel: 'silent'})
  try {
    const {CalculationDetails} = await server.ssrLoadModule('/src/content/dashboard/AskPanel.jsx')
    const html = renderToStaticMarkup(React.createElement(CalculationDetails, {calculation: result.calculation}))
    assert.match(html, /1,070 − 1,000 = 70 net stars/)
    assert.match(html, /1,042 − 1,070 = -28 net stars/)
    assert.match(html, /-28 − \(70\) = -98 stars/)
  } finally { await server.close() }
})
