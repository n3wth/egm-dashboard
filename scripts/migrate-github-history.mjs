import {execFile} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
import {historyMigrationStatements,historyVerificationSql} from '../egm-cloudflare/github-history-storage.mjs'

const execute=promisify(execFile)
const directory=fileURLToPath(new URL('../egm-cloudflare/',import.meta.url))

export async function migrateGithubHistory(run=execute) {
  async function query(sql) {
    let stdout
    try {
      ({stdout}=await run('npx',['--yes','wrangler@4.151.3','d1','execute','egm-growth-access','--remote','--command',sql,'--json'],{cwd:directory,encoding:'utf8',maxBuffer:1024*1024}))
    } catch {throw Error('D1 history migration command failed; Worker deployment must not continue')}
    let result
    try {result=JSON.parse(stdout)} catch {throw Error('D1 history migration returned invalid JSON')}
    if(!Array.isArray(result)||result.length!==1||result[0].success!==true||!Array.isArray(result[0].results))throw Error('D1 history migration did not succeed')
    return result[0].results
  }
  const columns=await query('PRAGMA table_info(snapshots)')
  if(!['id','body','generated_at'].every(name=>columns.some(column=>column.name===name)))throw Error('snapshots is missing; apply the base schema before deploying')
  const schema=await readFile(new URL('../egm-cloudflare/github-history-schema.sql',import.meta.url),'utf8')
  for(const statement of schema.split(';').map(value=>value.trim()).filter(Boolean))await query(statement)
  for(const sql of historyMigrationStatements)await query(sql)
  const [verification]=await query(historyVerificationSql)
  if(verification?.missing_daily!==0||verification?.missing_windows!==0)throw Error('GitHub history verification failed; Worker deployment must not continue')
  // The old Worker may still write during deployment; only the new runner removes embedded history atomically.
  return {dailyHistoryReady:true,windowHistoryReady:true}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  migrateGithubHistory().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1})
}
