import { bindings, defineConfig } from 'cf/config'

export default defineConfig({
  accountId: 'ac23513945eb49f73a89faf1be12384e',
  worker: {
    name: 'boing-staging',
    entrypoint: '../worker/boing-worker.mjs',
    compatibilityDate: '2026-10-28',
    domains: ['staging.boing.run', 'one.staging.boing.run'],
    workersDev: false,
    previewUrls: false,
    assets: { runWorkerFirst: true },
    env: {
      ASSETS: bindings.assets(),
      DB: bindings.d1({ name: 'boing-staging', id: 'a0f78332-5a82-43ad-9d4f-671a39b2cf97' }),
      APP_URL: bindings.text('https://staging.boing.run'),
      BOING_TENANT_BASE_URL: bindings.text('https://staging.boing.run'),
      BOING_ENVIRONMENT: bindings.text('staging'),
      BOING_PLATFORM_PROVISIONING_ENABLED: bindings.text('true'),
      BOING_PLATFORM_ADMIN_IDS: bindings.text('user_01M61N2H4FATHZTQ0QCZNA15ME'),
      BOING_MEMBERSHIP_BINDING_REQUIRED: bindings.text('true'),
      WORKOS_CLIENT_ID: bindings.text('client_01M61B3EQNH7RY05MT020GM0Q3'),
      WORKOS_RBAC_ISSUER: bindings.text('https://api.workos.com/user_management/client_01M61B3EQNH7RY05MT020GM0Q3'),
      WORKOS_API_KEY: bindings.secret(),
      BOING_AUTH_SECRET: bindings.secret(),
    },
  },
})
