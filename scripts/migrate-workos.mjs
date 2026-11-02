import {execFile} from 'node:child_process'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

const execute=promisify(execFile)
const directory=fileURLToPath(new URL('../egm-cloudflare/',import.meta.url))

export async function migrateWorkos(run=execute) {
  async function query(sql) {
    let stdout
    try {
      ({stdout}=await run('npx',['--yes','wrangler@4.151.3','d1','execute','egm-growth-access','--remote','--command',sql,'--json'],{cwd:directory,encoding:'utf8',maxBuffer:1024*1024}))
    } catch {
      throw Error('D1 schema command failed; Worker deployment must not continue')
    }
    let result
    try {result=JSON.parse(stdout)} catch {throw Error('D1 schema command returned invalid JSON')}
    if(!Array.isArray(result)||result.length!==1||result[0].success!==true||!Array.isArray(result[0].results))throw Error('D1 schema command did not succeed')
    return result[0].results
  }
  const columns=await query('PRAGMA table_info(workos_sessions)')
  if(!columns.some(column=>column.name==='session_id'))throw Error('workos_sessions is missing; apply the base session schema before deploying')
  const addedProviderSessionId=!columns.some(column=>column.name==='provider_session_id')
  if(addedProviderSessionId)await query('ALTER TABLE workos_sessions ADD COLUMN provider_session_id TEXT')
  await query('CREATE TABLE IF NOT EXISTS workos_webhook_events (id TEXT PRIMARY KEY, received_at TEXT NOT NULL)')
  const sessionColumns=await query('PRAGMA table_info(workos_sessions)')
  const receiptColumns=await query('PRAGMA table_info(workos_webhook_events)')
  if(!sessionColumns.some(column=>column.name==='provider_session_id')||!['id','received_at'].every(name=>receiptColumns.some(column=>column.name===name)))throw Error('WorkOS schema verification failed; Worker deployment must not continue')
  return {providerSessionColumnAdded:addedProviderSessionId,webhookReceiptTableReady:true}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  migrateWorkos().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1})
}
