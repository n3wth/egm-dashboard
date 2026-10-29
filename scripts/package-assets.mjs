import { mkdir, copyFile } from 'node:fs/promises'

await mkdir(new URL('../egm-cloudflare/assets/', import.meta.url), { recursive: true })
await copyFile(new URL('../egm-performance/dist/index.html', import.meta.url), new URL('../egm-cloudflare/assets/index.html', import.meta.url))
await mkdir(new URL('../egm-cloudflare/assets/rive/', import.meta.url), { recursive: true })
await copyFile(new URL('../egm-cloudflare/login-animation.js', import.meta.url), new URL('../egm-cloudflare/assets/rive/egm-login.js', import.meta.url))
await copyFile(new URL('../egm-performance/node_modules/@rive-app/canvas/rive.js', import.meta.url), new URL('../egm-cloudflare/assets/rive/rive.js', import.meta.url))
await copyFile(new URL('../egm-performance/node_modules/@rive-app/canvas/rive.wasm', import.meta.url), new URL('../egm-cloudflare/assets/rive/rive.wasm', import.meta.url))
await copyFile(new URL('../assets/branding/egm-handoff.riv', import.meta.url), new URL('../egm-cloudflare/assets/rive/egm-handoff.riv', import.meta.url))
await copyFile(new URL('../assets/branding/og.png', import.meta.url), new URL('../egm-cloudflare/assets/og.png', import.meta.url))
await copyFile(new URL('../assets/branding/apple-touch-icon.png', import.meta.url), new URL('../egm-cloudflare/assets/apple-touch-icon.png', import.meta.url))
console.log('Prepared Cloudflare dashboard assets')
