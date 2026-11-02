import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import config,{snapshotFile} from '../vite.config.js'
import {githubRequest} from '../../scripts/refresh-preview.mjs'

test('local snapshot override is selected only for development serving',async()=>{
  const root=await mkdtemp(join(tmpdir(),'egm-preview-'))
  try {
    assert.equal(snapshotFile('serve',root),join(root,'src/data.json'))
    await mkdir(join(root,'.data-app-preview'))
    await writeFile(join(root,'.data-app-preview/snapshot.json'),'{}')
    assert.equal(snapshotFile('serve',root),join(root,'.data-app-preview/snapshot.json'))
    assert.equal(snapshotFile('build',root),join(root,'src/data.json'))
  } finally {await rm(root,{recursive:true,force:true})}
})

test('preview adapter delegates authentication to gh and permits only EGM GitHub reads',async()=>{
  let calls=0
  const run=async(command,args,options)=>{
    calls++
    assert.equal(command,'gh')
    assert.deepEqual(args.slice(0,4),['api','repos/google/elephant-goldfish-model/traffic/views','--method','GET'])
    assert.ok(args.includes('Accept: application/vnd.github.star+json'))
    assert.doesNotMatch(JSON.stringify(args),/secret/)
    assert.equal(options.encoding,'utf8')
    return {stdout:'{"count":7}'}
  }
  const response=await githubRequest('https://api.github.com/repos/google/elephant-goldfish-model/traffic/views',{headers:{accept:'application/vnd.github.star+json',authorization:'Bearer secret'}},run)
  assert.deepEqual(await response.json(),{count:7})
  for(const url of ['https://other.example/repos/google/elephant-goldfish-model','https://api.github.com/repos/google/other','https://api.github.com/repos/google/elephant-goldfish-model-evil'])await assert.rejects(githubRequest(url,{},run),/must read/)
  await assert.rejects(githubRequest('https://api.github.com/repos/google/elephant-goldfish-model',{method:'POST'},run),/must read/)
  assert.equal(calls,1)
})

test('data imports and integrity metadata use the same selected snapshot',async()=>{
  for(const command of ['serve','build']) {
    const resolved=config({command,isSsrBuild:false})
    const selected=resolved.resolve.alias.find(alias=>alias.find instanceof RegExp&&alias.find.test('./data.json')).replacement
    const plugin=resolved.plugins.find(plugin=>plugin.name==='data-app-snapshot-integrity')
    const tags=await plugin.transformIndexHtml('',{})
    const digest=createHash('sha256').update(await readFile(selected)).digest('hex')
    assert.equal(tags.find(tag=>tag.attrs.name==='data-app-snapshot-sha256').attrs.content,digest)
  }
})
