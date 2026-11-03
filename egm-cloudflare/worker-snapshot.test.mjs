import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { handle, seal } from './worker.mjs'
import seed from '../egm-performance/src/data.json' with { type: 'json' }

test('dashboard snapshot omits stored history while preserving current data, version and access', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
    db.prepare("INSERT INTO users VALUES('viewer','viewer@example.org','Viewer',1,'approved','2026-01-01',NULL,NULL)").run()
    db.prepare("INSERT INTO sessions VALUES('s1','viewer',?)").run(Math.floor(Date.now()/1000)+7*86400)
    const snapshot={generatedAt:'2026-11-02T08:00:00Z',queries:{traffic:{rows:[{date:'2026-11-01',views:8}]}},githubHistory:{daily:{traffic:[{date:'2026-10-01',views:3}]},windows:[]}}
    const body=JSON.stringify(snapshot)
    db.prepare('INSERT INTO snapshots VALUES(1,?,?)').run(body,snapshot.generatedAt)
    const DB={prepare(sql){return {async first(){return db.prepare(sql).get()??null},bind(...args){return {async first(){return db.prepare(sql).get(...args)??null},async run(){return db.prepare(sql).run(...args)}}}}}}
    const env={DB,APP_URL:'https://dashboard.example',SESSION_SECRET:'a'.repeat(64)}
    const token=await seal({sid:'s1'},env.SESSION_SECRET,'session')
    const response=await handle(new Request(env.APP_URL+'/api/snapshot',{headers:{cookie:'__Host-egm_session='+token}}),env)
    assert.equal(response.status,200)
    assert.equal(response.headers.get('x-egm-snapshot-version'),snapshot.generatedAt)
    assert.equal(response.headers.get('cache-control'),'private, no-store')
    assert.deepEqual(await response.json(),{generatedAt:snapshot.generatedAt,queries:{...seed.queries,...snapshot.queries}})
    assert.equal(db.prepare('SELECT body FROM snapshots').get().body,body,'archive remains unchanged in storage')
    assert.equal((await handle(new Request(env.APP_URL+'/api/snapshot'),env)).status,401)
  } finally { db.close() }
})

test('dashboard snapshot overrides stale D1 weekly_brief and workflow_research when seed executedAt is newer', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
    db.prepare("INSERT INTO users VALUES('viewer','viewer@example.org','Viewer',1,'approved','2026-01-01',NULL,NULL)").run()
    db.prepare("INSERT INTO sessions VALUES('s1','viewer',?)").run(Math.floor(Date.now()/1000)+7*86400)
    const staleSnapshot={
      generatedAt:'2026-11-02T08:00:00Z',
      queries:{
        weekly_brief:{metadata:{isoWeek:'2026-W43'},rows:[],source:{executedAt:'2026-10-26T00:00:00Z'}},
        workflow_research:{metrics:{verifiedBlockerRetests:0},rows:[],source:{executedAt:'2026-10-26T00:00:00Z'}}
      }
    }
    db.prepare('INSERT INTO snapshots VALUES(1,?,?)').run(JSON.stringify(staleSnapshot),staleSnapshot.generatedAt)
    const DB={prepare(sql){return {async first(){return db.prepare(sql).get()??null},bind(...args){return {async first(){return db.prepare(sql).get(...args)??null},async run(){return db.prepare(sql).run(...args)}}}}}}
    const env={DB,APP_URL:'https://dashboard.example',SESSION_SECRET:'a'.repeat(64)}
    const token=await seal({sid:'s1'},env.SESSION_SECRET,'session')
    const response=await handle(new Request(env.APP_URL+'/api/snapshot',{headers:{cookie:'__Host-egm_session='+token}}),env)
    const payload=await response.json()
    assert.equal(payload.queries.weekly_brief.metadata.isoWeek,seed.queries.weekly_brief.metadata.isoWeek)
    assert.equal(payload.queries.workflow_research.rows.length,seed.queries.workflow_research.rows.length)
  } finally { db.close() }
})
