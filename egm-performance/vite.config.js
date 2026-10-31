import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { defineConfig } from "vite";

const localThreadId = [process.env.CODEX_SESSION_ID, process.env.CODEX_THREAD_ID].find((value) =>
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu.test(value ?? ""),
);

const snapshotIntegrityPlugin = {
  name: "data-app-snapshot-integrity",
  async transformIndexHtml(_html, context) {
    const root = fileURLToPath(new URL(".", import.meta.url));
    let snapshotBytes = readFileSync(new URL("./src/data.json", import.meta.url));
    if (context?.filename && /^examples\/[\w-]+\/index\.html$/u.test(relative(root, context.filename).replaceAll("\\", "/"))) {
      const entry = join(dirname(context.filename), "data.js");
      if (!existsSync(entry)) throw new Error(`Gallery example needs an explicit snapshot entry: ${entry}`);
      const { snapshot } = context.server ? await context.server.ssrLoadModule(entry) : await import(pathToFileURL(entry).href);
      snapshotBytes = JSON.stringify(snapshot, null, 2) + "\n";
    }
    return [
      {
        tag: "meta",
        attrs: {
          name: "data-app-snapshot-sha256",
          content: createHash("sha256")
            .update(snapshotBytes)
            .digest("hex"),
        },
        injectTo: "head",
      },
      ...(context?.server && context.filename ? [{
        tag: "meta",
        attrs: { name: "data-app-local-reference", content: JSON.stringify({ root, htmlPath: context.filename }) },
        injectTo: "head",
      }] : []),
    ];
  },
};

const vendorGroups = [
  ["react", /\/node_modules\/(react|react-dom|scheduler)\//u],
  ["charts", /\/node_modules\/(recharts|d3-[\w-]+|victory-vendor|internmap|decimal\.js-light|es-toolkit|immer|reselect|@reduxjs|react-redux|redux|use-sync-external-store|eventemitter3|clsx|tiny-invariant)\//u],
  ["ask", /\/node_modules\/(ai|@ai-sdk|zod|streamdown|react-markdown|parse5|shiki|@shikijs|mermaid|katex|micromark[\w-]*|mdast-[\w-]+|hast-[\w-]+|unist-[\w-]+|remark-[\w-]+|rehype-[\w-]+|unified|vfile[\w-]*)\//u],
  ["editor", /\/node_modules\/(lexical|@lexical)\//u],
  ["workos", /\/node_modules\/(@workos-inc|@radix-ui\/themes|@tanstack)\//u],
];

function vendorChunk(id) {
  const path = id.replaceAll("\\", "/");
  if (path.endsWith("/src/data.json")) return "snapshot";
  if (!path.includes("/node_modules/")) return undefined;
  return vendorGroups.find(([, pattern]) => pattern.test(path))?.[0] ?? "vendor";
}

export default defineConfig(({ command, isSsrBuild }) => ({
  // Gallery launchers and prepared apps consume the same authored reference modules.
  resolve: {
    alias: { "../../data-app-public.jsx": fileURLToPath(new URL("./src/data-app-public.jsx", import.meta.url)) },
    // Canonical examples live outside this package; use this app's installed UI runtime.
    dedupe: ["react", "react-dom", "recharts"],
  },
  plugins: isSsrBuild
    ? []
    : [
        snapshotIntegrityPlugin,
        {
          name: "data-app-local-task",
          // Development gallery only. Prepared apps retain their own root entry.
          configureServer(server) {
            if (!existsSync(join(server.config.root, "examples/product-tracker/main.jsx"))) return;
            server.middlewares.use((request, response, next) => {
              if (request.method !== "GET" || request.url?.split("?")[0] !== "/") return next();
              response.writeHead(302, { Location: `/examples/product-tracker/${request.url.slice(1)}` });
              response.end();
            });
          },
          transformIndexHtml: () =>
            localThreadId
              ? [
                  {
                    tag: "meta",
                    attrs: {
                      name: "data-app-local-thread",
                      content: localThreadId,
                    },
                    injectTo: "head",
                  },
                ]
              : [],
        },
      ],
  server: {
    allowedHosts: ["terminal.local"],
    ...(process.env.CODEX_SANDBOX === "seatbelt" ? { watch: { useFsEvents: false, usePolling: true } } : {}),
  },
  define: {
    __DATA_APP_PROJECT_ROOT__: JSON.stringify(command === "serve" ? process.cwd() : ""),
  },
  build: isSsrBuild ? { rollupOptions: { output: { entryFileNames: "index.js" } } } : {
    // Hashed chunks are served immutable. Libraries change far less often than
    // authored content or the bundled snapshot, so each gets its own chunk and a
    // deploy only invalidates what changed. Everything stays statically imported:
    // a deploy removes the previous chunks, so lazy chunks could 404 in open tabs.
    rollupOptions: { output: { manualChunks: vendorChunk } },
  },
}));
