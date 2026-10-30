import { defineConfig } from 'cf/config'

export default defineConfig({
  accountId: 'ac23513945eb49f73a89faf1be12384e',
  worker: {
    name: 'boing-site',
    compatibilityDate: '2026-10-28',
    domains: ['boing.run'],
    workersDev: false,
  },
})
