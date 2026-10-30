import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../site')
const output = resolve(here, 'dist')
const files = [
  'index.html', 'product.html', 'features.html', 'terms.html', 'privacy.html',
  'style.css', 'motion.js', 'rive/motion.js', 'rive/momentum.svg',
  'logo/boing-approved.png', 'logo/favicon.svg', 'vendor/gsap-3.15.0.min.js',
]

await rm(output, { recursive: true, force: true })
for (const file of files) {
  await mkdir(dirname(resolve(output, file)), { recursive: true })
  await copyFile(resolve(source, file), resolve(output, file))
}
