import { mkdir, copyFile } from 'node:fs/promises'

await mkdir(new URL('../egm-cloudflare/assets/', import.meta.url), { recursive: true })
await copyFile(new URL('../egm-performance/dist/index.html', import.meta.url), new URL('../egm-cloudflare/assets/index.html', import.meta.url))
console.log('Prepared Cloudflare dashboard assets')
