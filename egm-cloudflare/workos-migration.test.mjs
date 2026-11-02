import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {migrateWorkos} from '../scripts/migrate-workos.mjs'

function fixture(schema=true) {
  const db=new DatabaseSync(':memory:')
  db.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY); INSERT INTO sessions VALUES('existing')")
  if(schema) {
    const current=readFileSync(new URL('./workos-session-schema.sql',import.meta.url),'utf8')
    db.exec(current.replace(',\n  provider_session_id TEXT',''))
    db.exec("INSERT INTO workos_sessions(session_id,user_id,tokens) VALUES('existing','user_existing','encrypted')")
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
    const results=sql.startsWith('PRAGMA')?db.prepare(sql).all():(db.exec(sql),[])
    return {stdout:JSON.stringify([{success:true,results}])}
  }
  return {db,run,commands}
}

test('WorkOS deployment migration upgrades legacy schema and reruns without changing rows',async()=>{
  const f=fixture()
  try {
    assert.deepEqual(await migrateWorkos(f.run),{providerSessionColumnAdded:true,webhookReceiptTableReady:true})
    f.db.exec("INSERT INTO workos_webhook_events VALUES('event_existing','2026-11-02T00:00:00Z')")
    assert.deepEqual(await migrateWorkos(f.run),{providerSessionColumnAdded:false,webhookReceiptTableReady:true})
    assert.equal(f.commands.filter(sql=>sql.startsWith('ALTER TABLE')).length,1)
    assert.equal(f.db.prepare('SELECT tokens FROM workos_sessions').get().tokens,'encrypted')
    assert.equal(f.db.prepare('SELECT id FROM workos_webhook_events').get().id,'event_existing')
  } finally {f.db.close()}
})

test('missing base table stops the deployment guard before schema writes',async()=>{
  const f=fixture(false)
  try {
    await assert.rejects(migrateWorkos(f.run),/base session schema/)
    assert.deepEqual(f.commands,['PRAGMA table_info(workos_sessions)'])
  } finally {f.db.close()}
})

test('command, response, and migration failures stop the deployment guard',async()=>{
  await assert.rejects(migrateWorkos(async()=>{throw Error('upstream details')}),/D1 schema command failed/)
  await assert.rejects(migrateWorkos(async()=>({stdout:'invalid'})),/invalid JSON/)
  await assert.rejects(migrateWorkos(async()=>({stdout:JSON.stringify([{success:false,results:[]}])})),/did not succeed/)
  const f=fixture()
  try {
    await assert.rejects(migrateWorkos(async(...args)=>{
      if(args[1].includes('ALTER TABLE workos_sessions ADD COLUMN provider_session_id TEXT'))throw Error('migration denied')
      return f.run(...args)
    }),/D1 schema command failed/)
    assert.equal(f.db.prepare('SELECT tokens FROM workos_sessions').get().tokens,'encrypted')
    assert.equal(f.commands.some(sql=>sql.startsWith('CREATE TABLE')),false)
  } finally {f.db.close()}
})

test('successful command output does not bypass schema verification',async()=>{
  const f=fixture()
  try {
    await assert.rejects(migrateWorkos(async(...args)=>{
      if(args[1].includes('ALTER TABLE workos_sessions ADD COLUMN provider_session_id TEXT'))return {stdout:JSON.stringify([{success:true,results:[]}])}
      return f.run(...args)
    }),/schema verification failed/)
    assert.equal(f.db.prepare('SELECT tokens FROM workos_sessions').get().tokens,'encrypted')
  } finally {f.db.close()}
})
