import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { runRefresh } from './refresh-runner.mjs'

const baseTime = Date.parse('2026-10-28T00:00:00Z')
function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE snapshots(id INTEGER PRIMARY KEY,body TEXT NOT NULL,generated_at TEXT NOT NULL)')
  db.exec(readFileSync(new URL('./refresh-runner-schema.sql', import.meta.url), 'utf8'))
  const previous = { generatedAt: '2026-10-27T00:00:00Z', queries: { traffic: { rows: [{ views: 10 }] }, seo_keywords: { rows: [{ keyword: 'prior' }] }, semrush_status: { rows: [{ status: 'available' }] } } }
  db.prepare('INSERT INTO snapshots VALUES(1,?,?)').run(JSON.stringify(previous), previous.generatedAt)
  const DB = { prepare(sql) { return { bind(...args) { return { async first() { return db.prepare(sql).get(...args) ?? null }, async run() { return db.prepare(sql).run(...args) } } }, async first() { return db.prepare(sql).get() ?? null } } } }
  return { db, previous, env: { DB, REFRESH_UNTIL: '2026-11-04T06:33:00Z' } }
}
const noRequest = () => { throw Error('network not expected') }

test('Exa records survive the GitHub seed and update independently', async () => {
  const f = fixture()
  f.previous.queries.exa_mentions = { rows: [{ url: 'https://example.com/old' }] }
  f.db.prepare('UPDATE snapshots SET body=?').run(JSON.stringify(f.previous))
  const result = await runRefresh(f.env, noRequest, { now: () => baseTime, github: async () => { throw Error('offline') }, semrush: async () => ({}), mentions: async () => ({}), exa: async (env, request, previous) => {
    assert.equal(previous.exa_mentions.rows[0].url, 'https://example.com/old')
    return { exa_mentions: { rows: [{ url: 'https://example.com/new' }] }, exa_status: { rows: [{ status: 'available' }] } }
  } })
  assert.equal(result.exa, 'available')
  const saved = JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body)
  assert.equal(saved.queries.exa_mentions.rows[0].url, 'https://example.com/new')
  assert.equal(saved.queries.traffic.rows[0].views, 10)
})

test('lease makes concurrent calls skip and finished cooldown prevents immediate repeat', async () => {
  const f = fixture()
  let release
  const wait = new Promise(resolve => { release = resolve })
  let runs = 0
  const services = { now: () => baseTime, github: async () => { runs++; await wait; return { status: 'refreshed', snapshot: f.previous } }, semrush: async () => ({}), mentions: async () => ({}) }
  const running = runRefresh(f.env, noRequest, services)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await runRefresh(f.env, noRequest, services)).status, 'skipped')
  release()
  assert.equal((await running).status, 'refreshed')
  assert.equal((await runRefresh(f.env, noRequest, services)).status, 'skipped')
  assert.equal(runs, 1)
})

test('cutoff fails closed before any database or provider call', async () => {
  for (const until of [undefined, 'bad', '2026-10-27T00:00:00Z']) {
    assert.equal((await runRefresh({ REFRESH_UNTIL: until }, noRequest, { now: () => baseTime })).status, 'expired')
  }
})

test('GitHub failure keeps its timestamps and data while independent source updates publish', async () => {
  const f = fixture()
  const result = await runRefresh(f.env, noRequest, { now: () => baseTime, github: async () => { throw Error('secret source error') }, semrush: async (env, request, previous) => {
    assert.deepEqual(previous, f.previous.queries)
    return { seo_keywords: { rows: [{ keyword: 'fresh' }] }, semrush_status: { rows: [{ status: 'available' }] } }
  }, mentions: async () => { throw Error('secret mention error') } })
  const saved = JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body)
  assert.equal(result.status, 'partial')
  assert.equal(saved.generatedAt, f.previous.generatedAt)
  assert.deepEqual(saved.queries.traffic, f.previous.queries.traffic)
  assert.equal(saved.queries.seo_keywords.rows[0].keyword, 'fresh')
  assert.equal(JSON.stringify(result).includes('secret'), false)
  assert.equal(f.db.prepare('SELECT lease_id FROM refresh_control').get().lease_id, null)
})

test('independent source failures cannot overwrite newly collected GitHub data or old SEO', async () => {
  const f = fixture()
  await runRefresh(f.env, noRequest, { now: () => baseTime, github: async (env, request, research, options) => {
    assert.equal(options.persist, false)
    const latest = { generatedAt: '2026-10-28T00:00:00Z', queries: { traffic: { rows: [{ views: 20 }] } } }
    return { status: 'refreshed', snapshot: latest }
  }, semrush: async () => { throw Error('provider failure') }, mentions: async () => { throw Error('provider failure') } })
  const saved = JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body)
  assert.equal(saved.queries.traffic.rows[0].views, 20)
  assert.deepEqual(saved.queries.seo_keywords, f.previous.queries.seo_keywords)
})

test('staged GitHub data is never visible before final merge and retains prior source budgets', async () => {
  const f = fixture()
  f.previous.queries.exa_research_status = { rows: [{ successfulBatches: 3, totalCostDollars: 0.21 }] }
  f.db.prepare('UPDATE snapshots SET body=?').run(JSON.stringify(f.previous))
  let release
  const wait = new Promise(resolve => { release = resolve })
  const work = runRefresh(f.env, noRequest, {
    now: () => baseTime,
    github: async (env, request, research, options) => {
      assert.equal(options.persist, false)
      return { status: 'refreshed', snapshot: { generatedAt: new Date(baseTime).toISOString(), queries: { traffic: { rows: [{ views: 20 }] }, exa_research_status: { rows: [{ successfulBatches: 0, totalCostDollars: 0 }] } } } }
    },
    semrush: async () => { await wait; throw Error('provider failed') },
    mentions: async () => ({}), exa: async () => ({}), exaResearch: async () => { throw Error('offline') }, contentResearch: async () => ({})
  })
  await new Promise(resolve => setImmediate(resolve))
  const visible = JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body)
  assert.deepEqual(visible, f.previous)
  release()
  await work
  const saved = JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body)
  assert.equal(saved.queries.traffic.rows[0].views, 20)
  assert.deepEqual(saved.queries.exa_research_status, f.previous.queries.exa_research_status)
})

test('failed final publication leaves the entire prior snapshot and budget intact', async () => {
  const f = fixture()
  const base = f.env.DB
  f.env.DB = { prepare(sql) { if (sql.startsWith('INSERT INTO snapshots')) throw Error('storage unavailable'); return base.prepare(sql) } }
  await assert.rejects(runRefresh(f.env, noRequest, {
    now: () => baseTime,
    github: async () => ({ status: 'refreshed', snapshot: { generatedAt: new Date(baseTime).toISOString(), queries: { traffic: { rows: [{ views: 20 }] } } } }),
    semrush: async () => ({}), mentions: async () => ({}), exa: async () => ({}), exaResearch: async () => ({}), contentResearch: async () => ({})
  }), /storage unavailable/)
  assert.deepEqual(JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body), f.previous)
  assert.equal(f.db.prepare('SELECT lease_id FROM refresh_control').get().lease_id, null)
})

test('failed bootstrap skips paid collectors without discarding unpersistable budgets', async () => {
  const f = fixture()
  f.db.exec('DELETE FROM snapshots')
  let calls = 0
  const collector = async () => { calls++; return {} }
  const result = await runRefresh(f.env, noRequest, {
    now: () => baseTime, github: async () => { throw Error('GitHub unavailable') },
    semrush: collector, mentions: collector, exa: collector, exaResearch: collector, contentResearch: collector, youtube: collector, tavily: collector, parallel: collector
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'no_base_snapshot')
  assert.equal(result.semrush, 'skipped_no_snapshot')
  assert.equal(calls, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n, 0)
  assert.equal(f.db.prepare('SELECT lease_id FROM refresh_control').get().lease_id, null)
})

test('every collector checks deadline before consuming source attempt budgets', async () => {
  const names = ['semrush', 'mentions', 'exa', 'exaResearch', 'contentResearch', 'youtube', 'tavily', 'parallel']
  for (let stopAfter = -1; stopAfter < names.length; stopAfter++) {
    const f = fixture()
    const budget = { rows: [{ successfulBatches: 3, totalCostDollars: 0.21 }] }
    f.previous.queries.exa_research_status = budget
    f.db.prepare('UPDATE snapshots SET body=?').run(JSON.stringify(f.previous))
    let now = baseTime
    const calls = []
    const services = { now: () => now, github: async () => {
      if (stopAfter === -1) now += 10 * 60000
      return { status: 'refreshed', snapshot: f.previous }
    } }
    for (const [index, name] of names.entries()) services[name] = async () => {
      calls.push(name)
      if (index === stopAfter) now += 10 * 60000
      return {}
    }
    const result = await runRefresh(f.env, noRequest, services)
    assert.deepEqual(calls, names.slice(0, stopAfter + 1))
    for (const name of names.slice(stopAfter + 1)) assert.equal(result[name], 'skipped_deadline')
    const saved = JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body)
    assert.deepEqual(saved.queries.exa_research_status, budget)
  }
})
