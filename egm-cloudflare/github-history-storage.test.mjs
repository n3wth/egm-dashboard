import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {archiveStatements} from './github-history-storage.mjs'

const observed='2026-11-02T10:00:00Z'
const current={generatedAt:observed,queries:{traffic:{rows:[{date:'2026-11-01',views:8}],source:{executedAt:observed}},referrers:{rows:[{referrer:'example.com',count:5}],source:{executedAt:observed,caveats:['Overlapping rolling window']}}}}
function fixture() {
  const db=new DatabaseSync(':memory:')
  for(const file of ['schema.sql','refresh-runner-schema.sql','github-history-schema.sql'])db.exec(readFileSync(new URL(file,import.meta.url),'utf8'))
  db.prepare('INSERT INTO snapshots VALUES(1,?,?)').run(JSON.stringify(current),observed)
  db.prepare("UPDATE refresh_control SET lease_id='lease',lease_until=? WHERE id=1").run(Date.parse(observed)+60000)
  const DB={prepare(sql){return {bind(...args){return {sql,args}}}}}
  const batch=statements=>{
    db.exec('BEGIN')
    try {for(const {sql,args} of statements)db.prepare(sql).all(...args);db.exec('COMMIT')}
    catch(error){db.exec('ROLLBACK');throw error}
  }
  return {db,DB,batch}
}

test('normalized archive imports legacy rows and preserves exact window source metadata',()=>{
  const f=fixture()
  try {
    const previous={generatedAt:'2026-11-01T10:00:00Z',githubHistory:{daily:{traffic:[{date:'2026-10-01',views:3,observedAt:'2026-10-02T10:00:00Z'}]},windows:[{observedAt:'2026-10-02T10:00:00Z',queries:{referrers:current.queries.referrers}}]}}
    f.batch(archiveStatements(f.DB,previous,current,observed,'lease'))
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM github_daily_history').get().n,2)
    const old=f.db.prepare("SELECT body FROM github_daily_history WHERE date='2026-10-01'").get()
    assert.equal(JSON.parse(old.body).views,3)
    const windows=f.db.prepare('SELECT * FROM github_window_history ORDER BY collection_date').all()
    assert.deepEqual(windows.map(row=>row.collection_date),['2026-10-02','2026-11-02'])
    assert.deepEqual(JSON.parse(windows[1].body),current.queries.referrers)
    assert.equal(f.db.prepare('SELECT body FROM snapshots').get().body,JSON.stringify(current))
  } finally {f.db.close()}
})

test('overlapping daily counts use the newer observation and never add or regress values',()=>{
  const f=fixture()
  try {
    f.batch(archiveStatements(f.DB,{},current,observed,'lease'))
    const older={...current,queries:{traffic:{rows:[{date:'2026-11-01',views:2}],source:{executedAt:'2026-11-01T10:00:00Z'}}}}
    f.batch(archiveStatements(f.DB,older,{},observed,'lease'))
    assert.equal(JSON.parse(f.db.prepare('SELECT body FROM github_daily_history').get().body).views,8)
    const newer={...current,queries:{traffic:{rows:[{date:'2026-11-01',views:9}],source:{executedAt:'2026-11-02T10:01:00Z'}}}}
    f.batch(archiveStatements(f.DB,{},newer,observed,'lease'))
    assert.equal(JSON.parse(f.db.prepare('SELECT body FROM github_daily_history').get().body).views,9)
  } finally {f.db.close()}
})

test('lost fencing token or a different snapshot version prevents all archive writes',()=>{
  const f=fixture()
  try {
    f.batch(archiveStatements(f.DB,{},current,observed,'lost-lease'))
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM github_daily_history').get().n,0)
    f.batch(archiveStatements(f.DB,{},current,'2026-11-02T09:00:00Z','lease'))
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM github_window_history').get().n,0)
    f.db.prepare('UPDATE refresh_control SET lease_until=?').run(Date.parse(observed))
    f.batch(archiveStatements(f.DB,{},current,observed,'lease'))
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM github_daily_history').get().n,0)
  } finally {f.db.close()}
})

test('an archive failure rolls back the snapshot and earlier archive statements together',()=>{
  const f=fixture()
  try {
    const before=f.db.prepare('SELECT body FROM snapshots').get().body
    f.db.exec("CREATE TRIGGER fail_window BEFORE INSERT ON github_window_history BEGIN SELECT RAISE(ABORT,'archive unavailable'); END")
    const snapshotWrite=f.DB.prepare('UPDATE snapshots SET body=? WHERE id=1').bind(JSON.stringify({...current,title:'changed'}))
    assert.throws(()=>f.batch([snapshotWrite,...archiveStatements(f.DB,{},current,observed,'lease')]),/archive unavailable/)
    assert.equal(f.db.prepare('SELECT body FROM snapshots').get().body,before)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM github_daily_history').get().n,0)
  } finally {f.db.close()}
})

test('many retained days do not get loaded into current snapshot or future archive statements',()=>{
  const f=fixture()
  try {
    const before=f.db.prepare('SELECT body FROM snapshots').get().body
    const initial=archiveStatements(f.DB,{},current,observed,'lease').map(statement=>statement.args)
    const insert=f.db.prepare('INSERT INTO github_window_history VALUES(?,?,?,?)')
    for(let day=0;day<400;day++) {
      const time=new Date(Date.parse('2024-01-01T10:00:00Z')+day*86400000).toISOString()
      insert.run('referrers',time.slice(0,10),time,JSON.stringify(current.queries.referrers))
    }
    f.batch(archiveStatements(f.DB,{},current,observed,'lease'))
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM github_window_history').get().n,401)
    assert.equal(f.db.prepare('SELECT body FROM snapshots').get().body,before)
    assert.deepEqual(archiveStatements(f.DB,{},current,observed,'lease').map(statement=>statement.args),initial)
  } finally {f.db.close()}
})

test('archive keys reject impossible dates while accepting real leap days',()=>{
  const f=fixture()
  try {
    const daily=f.db.prepare('INSERT INTO github_daily_history VALUES(?,?,?,?)')
    const windows=f.db.prepare('INSERT INTO github_window_history VALUES(?,?,?,?)')
    for(const date of ['2026-99-01','2026-02-30','2026-02-29']) {
      assert.throws(()=>daily.run('traffic',date,observed,'{}'),/CHECK constraint failed/)
      assert.throws(()=>windows.run('referrers',date,observed,'{}'),/CHECK constraint failed/)
    }
    daily.run('traffic','2024-02-29',observed,'{}')
    windows.run('referrers','2024-02-29',observed,'{}')
    assert.equal(f.db.prepare('SELECT date FROM github_daily_history').get().date,'2024-02-29')
    assert.equal(f.db.prepare('SELECT collection_date FROM github_window_history').get().collection_date,'2024-02-29')
  } finally {f.db.close()}
})
