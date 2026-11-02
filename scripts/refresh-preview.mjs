// Local GitHub reads only: no production writes or independent provider calls.
import {execFile} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
import seed from '../egm-performance/src/data.json' with {type:'json'}
import {refreshSnapshot} from '../egm-cloudflare/refresh.mjs'

const runGh=promisify(execFile)
const output=fileURLToPath(new URL('../egm-performance/.data-app-preview/snapshot.json',import.meta.url))

export async function githubRequest(url,init={},run=runGh) {
  const parsed=new URL(url)
  const base='/repos/google/elephant-goldfish-model'
  if(parsed.origin!=='https://api.github.com'||parsed.username||parsed.password||!(parsed.pathname===base||parsed.pathname.startsWith(base+'/'))||(init.method??'GET')!=='GET')throw Error('Preview requests must read the EGM GitHub repository')
  try {
    const {stdout}=await run('gh',['api',parsed.pathname.slice(1)+parsed.search,'--method','GET','-H',`Accept: ${init.headers?.accept??'application/vnd.github+json'}`,'-H','X-GitHub-Api-Version: 2022-11-28'],{encoding:'utf8',maxBuffer:8*1024*1024,signal:init.signal})
    return new Response(stdout,{headers:{'content-type':'application/json'}})
  } catch {
    throw Error(`GitHub preview read failed: ${parsed.pathname}`)
  }
}

export async function refreshPreview() {
  const previous=existsSync(output)?JSON.parse(await readFile(output,'utf8')):seed
  if(previous.id!==seed.id||!previous.queries)throw Error('Existing preview snapshot does not match this dashboard')
  const result=await refreshSnapshot({GITHUB_TOKEN:'authenticated-by-gh-cli',REFRESH_UNTIL:new Date(Date.now()+30*60000).toISOString()},githubRequest,async()=>({}),{persist:false,previousSnapshot:previous})
  if(result.status!=='refreshed'||!result.snapshot?.queries)throw Error('Preview snapshot was not refreshed')
  await mkdir(dirname(output),{recursive:true})
  const temporary=join(dirname(output),`snapshot-${process.pid}.tmp`)
  await writeFile(temporary,JSON.stringify(result.snapshot,null,2)+'\n',{mode:0o600})
  await rename(temporary,output)
  return {generatedAt:result.generatedAt,trafficThrough:result.trafficEnd,stars:result.stars,starHistoryStatus:result.starHistoryStatus}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  refreshPreview().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1})
}
