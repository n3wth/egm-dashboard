import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {migrateGithubHistory} from '../scripts/migrate-github-history.mjs'

function fixture(base=true) {
  const db=new DatabaseSync(':memory:')
  const legacy={generatedAt:'2026-10-21T10:00:00Z',queries:{traffic:{rows:[{date:'2026-10-20',views:20}],source:{executedAt:'2026-10-21T10:00:00Z'}}},githubHistory:{daily:{traffic:Array.from({length:19},(_,index)=>({date:`2026-10-${String(index+1).padStart(2,'0')}`,views:index+1,observedAt:'2026-10-20T10:00:00Z'}))},windows:[1,2].map(day=>({observedAt:`2026-10-0${day}T10:00:00Z`,queries:{referrers:{rows:[{referrer:'example.com',count:day}],source:{executedAt:`2026-10-0${day}T10:00:00Z`}}}}))}}
  if(base) {
    db.exec('CREATE TABLE snapshots(id INTEGER PRIMARY KEY,body TEXT NOT NULL,generated_at TEXT NOT NULL)')
    db.prepare('INSERT INTO snapshots VALUES(1,?,?)').run(JSON.stringify(legacy),legacy.generatedAt)
  }
  const commands=[]
  const run=async(command,args,options)=>{
    assert.equal(command,'npx')
    assert.deepEqual(args.slice(0,5),['--yes','wrangler@4.151.3','d1','execute','egm-growth-access'])
    assert.ok(args.includes('--remote'))
    assert.ok(args.includes('--json'))
    assert.ok(options.cwd.endsWith('/egm-cloudflare/'))
    const sql=args[args.indexOf('--command')+1]
    commands.push(sql)
    return {stdout:JSON.stringify([{success:true,results:db.prepare(sql).all()}])}
  }
  return {db,run,commands,legacy}
}

test('predeploy migrates all 19 legacy daily dates and two windows without deleting embedded data',async()=>{
  const f=fixture()
  try {
    assert.deepEqual(await migrateGithubHistory(f.run),{dailyHistoryReady:true,windowHistoryReady:true})
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM github_daily_history').get().n,20)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM github_window_history').get().n,2)
    const first=f.db.prepare("SELECT body FROM github_window_history WHERE collection_date='2026-10-01'").get()
    assert.deepEqual(JSON.parse(first.body),f.legacy.githubHistory.windows[0].queries.referrers)
    const body=f.db.prepare('SELECT body FROM snapshots').get().body
    assert.equal(body,JSON.stringify(f.legacy))
    await migrateGithubHistory(f.run)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM github_daily_history').get().n,20)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM github_window_history').get().n,2)
    assert.equal(f.db.prepare('SELECT body FROM snapshots').get().body,body)
  } finally {f.db.close()}
})

test('missing base schema stops deployment before writes',async()=>{
  const f=fixture(false)
  try {
    await assert.rejects(migrateGithubHistory(f.run),/apply the base schema/)
    assert.deepEqual(f.commands,['PRAGMA table_info(snapshots)'])
  } finally {f.db.close()}
})

test('migration command or response failures stop deployment without exposing upstream details',async()=>{
  await assert.rejects(migrateGithubHistory(async()=>{throw Error('private response')}),/D1 history migration command failed/)
  await assert.rejects(migrateGithubHistory(async()=>({stdout:'invalid'})),/invalid JSON/)
  await assert.rejects(migrateGithubHistory(async()=>({stdout:JSON.stringify([{success:false,results:[]}])})),/did not succeed/)
})

test('partial migration failure leaves legacy data intact and can be retried safely',async()=>{
  const f=fixture()
  try {
    await assert.rejects(migrateGithubHistory(async(...args)=>{
      if(args[1][args[1].indexOf('--command')+1].includes('INSERT INTO github_window_history'))throw Error('write denied')
      return f.run(...args)
    }),/migration command failed/)
    assert.equal(f.db.prepare('SELECT body FROM snapshots').get().body,JSON.stringify(f.legacy))
    await migrateGithubHistory(f.run)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM github_daily_history').get().n,20)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM github_window_history').get().n,2)
  } finally {f.db.close()}
})

test('success output without copied rows cannot bypass migration verification',async()=>{
  const f=fixture()
  try {
    await assert.rejects(migrateGithubHistory(async(...args)=>{
      if(args[1][args[1].indexOf('--command')+1].includes('INSERT INTO github_'))return {stdout:JSON.stringify([{success:true,results:[]}])}
      return f.run(...args)
    }),/history verification failed/)
    assert.equal(f.db.prepare('SELECT body FROM snapshots').get().body,JSON.stringify(f.legacy))
  } finally {f.db.close()}
})
