import { mkdir, copyFile, cp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function packageAssets(root=new URL('../',import.meta.url)) {
  const assetRoot=new URL('egm-cloudflare/assets/',root)
  await mkdir(assetRoot,{recursive:true})
  await copyFile(new URL('egm-performance/dist/index.html',root),new URL('index.html',assetRoot))
  // Replace only generated chunks; retain the checked-in font and favicon assets.
  await rm(new URL('assets/',assetRoot),{recursive:true,force:true})
  await cp(new URL('egm-performance/dist/assets/',root),new URL('assets/',assetRoot),{recursive:true})
  await mkdir(new URL('rive/',assetRoot),{recursive:true})
  await copyFile(new URL('egm-cloudflare/login-animation.js',root),new URL('rive/egm-login.js',assetRoot))
  await copyFile(new URL('egm-performance/node_modules/@rive-app/canvas/rive.js',root),new URL('rive/rive.js',assetRoot))
  await copyFile(new URL('egm-performance/node_modules/@rive-app/canvas/rive.wasm',root),new URL('rive/rive.wasm',assetRoot))
  await copyFile(new URL('assets/branding/egm-handoff.riv',root),new URL('rive/egm-handoff.riv',assetRoot))
  await copyFile(new URL('assets/branding/og.png',root),new URL('og.png',assetRoot))
  await copyFile(new URL('assets/branding/apple-touch-icon.png',root),new URL('apple-touch-icon.png',assetRoot))
  await mkdir(new URL('email/',assetRoot),{recursive:true})
  await copyFile(new URL('assets/branding/egm-mark-black.png',root),new URL('email/egm-mark-black.png',assetRoot))
  await copyFile(new URL('assets/branding/egm-mark-white.png',root),new URL('email/egm-mark-white.png',assetRoot))
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await packageAssets()
  console.log('Prepared Cloudflare dashboard assets')
}
