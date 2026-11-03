import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
import {packageAssets} from '../scripts/package-assets.mjs'

const files={
  'egm-performance/dist/index.html':'<script type="module" src="/assets/index-ABCD1234.js"></script><link rel="stylesheet" href="/assets/style-EFGH5678.css">',
  'egm-performance/dist/assets/index-ABCD1234.js':'import "./vendor-IJKL9012.js";',
  'egm-performance/dist/assets/vendor-IJKL9012.js':'export const library=true;',
  'egm-performance/dist/assets/style-EFGH5678.css':'body { color: black }',
  'egm-performance/dist/assets/font-MNOP3456.woff2':'font',
  'egm-cloudflare/login-animation.js':'animation',
  'egm-performance/node_modules/@rive-app/canvas/rive.js':'rive',
  'egm-performance/node_modules/@rive-app/canvas/rive.wasm':'wasm',
  'assets/branding/egm-handoff.riv':'handoff',
  'assets/branding/og.png':'open-graph',
  'assets/branding/apple-touch-icon.png':'touch',
  'assets/branding/egm-mark-black.png':'black',
  'assets/branding/egm-mark-white.png':'white',
  'egm-cloudflare/assets/assets/stale-AAAAAAAA.js':'old deployment',
  'egm-cloudflare/assets/fonts/SuisseIntl-Book.woff2':'existing font',
  'egm-cloudflare/assets/favicon.svg':'existing favicon'
}
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'egm-package-assets-'))
  for(const [path,content] of Object.entries(files)) {
    await mkdir(dirname(join(root,path)),{recursive:true})
    await writeFile(join(root,path),content)
  }
  return root
}

test('packaging includes every built chunk and replaces stale chunks without removing public assets',async()=>{
  const root=await fixture()
  try {
    await packageAssets(pathToFileURL(root+'/'))
    const target=join(root,'egm-cloudflare/assets')
    assert.deepEqual((await readdir(join(target,'assets'))).sort(),['font-MNOP3456.woff2','index-ABCD1234.js','style-EFGH5678.css','vendor-IJKL9012.js'])
    for(const path of ['index.html','assets/index-ABCD1234.js','assets/vendor-IJKL9012.js','assets/style-EFGH5678.css','assets/font-MNOP3456.woff2']) {
      assert.equal(await readFile(join(target,path),'utf8'),files['egm-performance/dist/'+path],path)
    }
    for(const path of ['rive/egm-login.js','rive/rive.js','rive/rive.wasm','rive/egm-handoff.riv','og.png','apple-touch-icon.png','email/egm-mark-black.png','email/egm-mark-white.png'])assert.ok((await readFile(join(target,path))).length,path)
    assert.equal(await readFile(join(target,'fonts/SuisseIntl-Book.woff2'),'utf8'),'existing font')
    assert.equal(await readFile(join(target,'favicon.svg'),'utf8'),'existing favicon')
  } finally {await rm(root,{recursive:true,force:true})}
})

test('packaging fails when the chunk directory is missing rather than publishing a broken shell',async()=>{
  const root=await fixture()
  try {
    await rm(join(root,'egm-performance/dist/assets'),{recursive:true})
    await assert.rejects(packageAssets(pathToFileURL(root+'/')),{code:'ENOENT'})
  } finally {await rm(root,{recursive:true,force:true})}
})
