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
  const previous = { generatedAt: '2026-10-27T00:00:00Z', queries: { traffic: { rows: [{ date: '2026-10-26', views: 10 }] }, seo_keywords: { rows: [{ keyword: 'prior' }] }, semrush_status: { rows: [{ status: 'available' }] } } }
  db.prepare('INSERT INTO snapshots VALUES(1,?,?)').run(JSON.stringify(previous), previous.generatedAt)
  const DB = { prepare(sql) { return { bind(...args) { return { async first() { return db.prepare(sql).get(...args) ?? null }, async run() { return db.prepare(sql).run(...args) } } }, async first() { return db.prepare(sql).get() ?? null } } } }
  return { db, previous, env: { DB, REFRESH_UNTIL: '2026-11-04T06:33:00Z' } }
}
const noRequest = () => { throw Error('network not expected') }

test('transition preserves prior site data, honors both legacy attempts, and keeps comments', async () => {
  const f = fixture()
  const attempted = new Date(baseTime - 3600000).toISOString()
  const legacy = { rows: [{ kind: 'Lab', score: 80, observedAt: attempted, lastAttemptAt: attempted }, { kind: 'Field', lcp: 1700, observedAt: attempted, lastAttemptAt: attempted }], source: { label: 'legacy phone data' } }
  f.previous.queries.site_performance = legacy
  f.db.prepare('UPDATE snapshots SET body=?').run(JSON.stringify(f.previous))
  const result = await runRefresh({ ...f.env, GOOGLE_PERFORMANCE_API_KEY: 'fixture' }, noRequest, {
    now: () => baseTime,
    github: async () => ({ status: 'refreshed', snapshot: { ...f.previous, queries: { traffic: f.previous.queries.traffic, site_performance: { rows: [] } } } }),
    semrush: async () => ({}), mentions: async () => ({ mentions: { rows: [{ url: 'https://example.com/video' }] } }),
    exa: async () => ({}), exaResearch: async () => ({}), contentResearch: async () => ({}), youtube: async () => ({}),
    youtubeComments: async (env, request, queries) => { assert.equal(queries.mentions.rows[0].url, 'https://example.com/video'); return { youtube_comments: { rows: [{ videoId: 'fixture' }] }, youtube_comments_status: { rows: [{ status: 'checked' }] } } },
    tavily: async () => ({}), parallel: async () => ({}), engagement: async () => ({})
  })
  const saved = JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body)
  assert.equal(result.youtubeComments, 'checked')
  assert.equal(saved.githubHistory.daily.traffic.find(row=>row.date==='2026-10-26').views,10)
  assert.ok(saved.githubHistory.daily.traffic.some(row=>row.date==='2026-10-13'),'recover reviewed seed history before the live window')
  assert.deepEqual(saved.queries.site_performance, legacy)
  assert.equal(saved.queries.youtube_comments.rows[0].videoId, 'fixture')
  assert.equal(saved.queries.web_pagespeed_status.rows[0].nextAttemptAt, new Date(baseTime + 23 * 3600000).toISOString())
  assert.equal(saved.queries.web_crux_status.rows[0].nextAttemptAt, new Date(baseTime + 23 * 3600000).toISOString())
  assert.equal(saved.queries.web_crux, undefined)
})

test('existing alternate Google key works for the single performance collector', async () => {
  const f = fixture()
  let checked = false
  await runRefresh({ ...f.env, GOOGLE_PERFORMANCE_API_KEY: 'fallback' }, noRequest, {
    now: () => baseTime, github: async () => ({ status: 'refreshed', snapshot: f.previous }),
    webPerformance: async env => { checked = true; assert.equal(env.GOOGLE_WEB_PERFORMANCE_API_KEY, 'fallback'); return {} }
  })
  assert.equal(checked, true)
})

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

test('a provider inside its interval or over the monthly cap is not called', async () => {
  const f = fixture()
  f.previous.queries.semrush_status = { rows: [{ status: 'available', nextAttemptAt: '2026-10-29T00:00:00Z', lastSuccessAt: '2026-10-27T00:00:00Z' }] }
  f.previous.refreshStatus = { budget: { month: '2026-10', calls: { mentions: 31 } } }
  f.db.prepare('UPDATE snapshots SET body=?').run(JSON.stringify(f.previous))
  let semrush = 0, mentions = 0
  const result = await runRefresh(f.env, noRequest, {
    now: () => baseTime,
    github: async () => ({ status: 'refreshed', snapshot: f.previous }),
    semrush: async () => { semrush++; return {} },
    mentions: async () => { mentions++; return {} }
  })
  assert.equal(semrush, 0)
  assert.equal(mentions, 0)
  assert.equal(result.semrush, 'cached')
  assert.equal(result.mentions, 'cached')
  const saved = JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body)
  assert.equal(saved.refreshStatus.collectionEndsAt, '2026-11-04T06:33:00.000Z')
  assert.equal(saved.refreshStatus.sources.find(source => source.id === 'semrush').lastSuccessAt, '2026-10-27T00:00:00Z')
  assert.equal(saved.refreshStatus.sources.find(source => source.id === 'mentions').reason, 'monthly_cap')
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
    const latest = { generatedAt: '2026-10-28T00:00:00Z', queries: { traffic: { rows: [{ date: '2026-10-27', views: 20 }] } } }
    return { status: 'refreshed', snapshot: latest }
  }, semrush: async () => { throw Error('provider failure') }, mentions: async () => { throw Error('provider failure') } })
  const saved = JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body)
  assert.equal(saved.queries.traffic.rows[0].views, 20)
  assert.deepEqual(saved.queries.seo_keywords, f.previous.queries.seo_keywords)
  assert.equal(saved.refreshStatus.collectors.semrush, 'failed')
  assert.equal(saved.refreshStatus.collectors.mentions, 'failed')
  assert.equal(saved.refreshStatus.collectors.github, 'refreshed')
  assert.equal(saved.refreshStatus.checkedAt, new Date(baseTime).toISOString())
  assert.deepEqual(saved.queries.semrush_status, f.previous.queries.semrush_status)
})

test('persisted collector outcomes preserve partial and unconfigured states without copying arbitrary values', async () => {
  const f = fixture()
  await runRefresh(f.env, noRequest, {
    now: () => baseTime, github: async () => ({ status: 'refreshed', snapshot: f.previous }),
    semrush: async () => ({ semrush_status: { rows: [{ status: 'partial' }] } }),
    mentions: async () => ({ mentions_status: { rows: [{ status: 'unconfigured' }] } }),
    exa: async () => ({ exa_status: { rows: [{ status: 'private error value' }] } })
  })
  const status = JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body).refreshStatus.collectors
  assert.equal(status.semrush, 'partial')
  assert.equal(status.mentions, 'unconfigured')
  assert.equal(status.exa, 'unknown')
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
      return { status: 'refreshed', snapshot: { generatedAt: new Date(baseTime).toISOString(), queries: { traffic: { rows: [{ date: '2026-10-27', views: 20 }] }, exa_research_status: { rows: [{ successfulBatches: 0, totalCostDollars: 0 }] } } } }
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
    github: async () => ({ status: 'refreshed', snapshot: { generatedAt: new Date(baseTime).toISOString(), queries: { traffic: { rows: [{ date: '2026-10-27', views: 20 }] } } } }),
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
    semrush: collector, mentions: collector, exa: collector, exaResearch: collector, contentResearch: collector, youtube: collector, tavily: collector, parallel: collector, engagement: collector
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'no_base_snapshot')
  assert.equal(result.semrush, 'skipped_no_snapshot')
  assert.equal(calls, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n, 0)
  assert.equal(f.db.prepare('SELECT lease_id FROM refresh_control').get().lease_id, null)
})

test('every collector checks deadline before consuming source attempt budgets', async () => {
  const names = ['semrush', 'mentions', 'exa', 'exaResearch', 'contentResearch', 'youtube', 'tavily', 'parallel', 'engagement']
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
test('engagement reads newly merged discovery and commits actual HN counts with the snapshot',async()=>{
  const f=fixture()
  let calls=0
  const services={now:()=>baseTime,github:async()=>({status:'refreshed',snapshot:f.previous}),semrush:async()=>({}),mentions:async()=>({mentions:{rows:[{url:'https://news.ycombinator.com/item?id=123'}]}}),exa:async()=>({}),exaResearch:async()=>({}),contentResearch:async()=>({}),youtube:async()=>({}),tavily:async()=>({}),parallel:async()=>({})}
  const result=await runRefresh(f.env,async(url,init)=>{calls++;assert.equal(url,'https://hacker-news.firebaseio.com/v0/item/123.json');assert.equal(init.redirect,'manual');return Response.json({id:123,type:'story',score:2,descendants:0})},services)
  const saved=JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body)
  assert.equal(result.engagement,'checked')
  assert.equal(calls,1)
  assert.equal(saved.queries.mention_engagement.rows[0].hnPoints,2)
  assert.equal(saved.queries.mention_engagement.rows[0].comments,0)
})
test('engagement saved cache and budgets survive stale GitHub seeds without network calls',async()=>{
  const f=fixture()
  const observedAt=new Date(baseTime-1000).toISOString()
  const engagement={rows:[{hnId:'123',url:'https://news.ycombinator.com/item?id=123',hnPoints:8,lastAttemptAt:observedAt,engagementObservedAt:observedAt}],source:{executedAt:observedAt}}
  const status={rows:[{collectionDay:new Date(baseTime).toISOString().slice(0,10),dailyAttempts:5}]}
  f.previous.queries.mention_engagement=engagement
  f.previous.queries.mention_engagement_status=status
  f.db.prepare('UPDATE snapshots SET body=?').run(JSON.stringify(f.previous))
  const services={now:()=>baseTime,github:async()=>({status:'refreshed',snapshot:{...f.previous,queries:{...f.previous.queries,mention_engagement:{rows:[]},mention_engagement_status:{rows:[{dailyAttempts:0}]}}}}),semrush:async()=>({}),mentions:async()=>({mentions:{rows:[{url:'https://news.ycombinator.com/item?id=123'}]}}),exa:async()=>({}),exaResearch:async()=>({}),contentResearch:async()=>({}),youtube:async()=>({}),tavily:async()=>({}),parallel:async()=>({})}
  let calls=0
  const result=await runRefresh(f.env,async()=>{calls++;throw Error('unexpected network')},services)
  const saved=JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body)
  assert.equal(result.engagement,'cached')
  assert.equal(calls,0)
  assert.deepEqual(saved.queries.mention_engagement,engagement)
  assert.equal(saved.queries.mention_engagement_status.rows[0].dailyAttempts,5)
})

test('Workers adapter normalizes redirect error to manual and rejects provider redirects without following', async () => {
  for (const code of [200, 302, 307]) {
    const f = fixture()
    let calls = 0
    let redirectRejected = false
    const result = await runRefresh(f.env, async (url, init) => {
      calls++
      assert.equal(url, 'https://api.provider.example/search')
      assert.equal(init.redirect, 'manual')
      assert.equal(init.headers.authorization, 'Bearer fixture-token')
      return new Response(null, { status: code, ...(code >= 300 ? { headers: { location: 'https://different.example/collect' } } : {}) })
    }, {
      now: () => baseTime,
      github: async () => { throw Error('retain last good GitHub') },
      semrush: async (env, request) => {
        const pending = request('https://api.provider.example/search', { redirect: 'error', headers: { authorization: 'Bearer fixture-token' } })
        if (code >= 300) {
          await assert.rejects(pending, { message: 'unexpected_redirect' })
          redirectRejected = true
          throw Error('unexpected_redirect')
        }
        const response = await pending
        assert.equal(response.status, 200)
        return { seo_keywords: { rows: [{ keyword: 'new' }] } }
      },
      mentions: async () => ({}), exa: async () => ({}), exaResearch: async () => ({}), contentResearch: async () => ({}), youtube: async () => ({}), tavily: async () => ({}), parallel: async () => ({})
    })
    assert.equal(calls, 1)
    assert.equal(redirectRejected, code >= 300)
    const saved = JSON.parse(f.db.prepare('SELECT body FROM snapshots').get().body)
    if (code === 200) assert.equal(saved.queries.seo_keywords.rows[0].keyword, 'new')
    else {
      assert.equal(result.semrush, 'failed')
      assert.deepEqual(saved.queries.seo_keywords, f.previous.queries.seo_keywords)
      assert.deepEqual(saved.queries.traffic, f.previous.queries.traffic)
    }
  }
})
