import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    "name": "egm-cloudflare",
    "compatibilityDate": "2026-09-21",
    "observability": {
      "enabled": true
    }
  }
});
