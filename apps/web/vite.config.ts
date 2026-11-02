import vue from "@vitejs/plugin-vue"
import { fileURLToPath } from "node:url"
import { defineConfig, loadEnv } from "vite"

/**
 * The UI never gets a second API surface: it talks to `RPC_PATH` over the same
 * NDJSON `effect/rpc` protocol as the CLI. During `vite dev` the request stays
 * same-origin and is proxied to the local cloud server, so no CORS setup is
 * required. A built bundle can point at any server with `OTBOR_API_URL`.
 */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url))

export default defineConfig(({ mode }) => {
  // Load only the OTBOR_ namespace: no crawler proxy secret can leak into the
  // browser bundle, and only the single URL is published.
  const env = loadEnv(mode, repoRoot, "OTBOR_")
  const configured = env.OTBOR_API_URL?.trim() ?? ""

  let proxyTarget = "http://127.0.0.1:3001"
  if (configured !== "") {
    try {
      proxyTarget = new URL(configured).origin
    } catch {
      // A relative endpoint such as `/rpc` keeps the default local target.
    }
  }

  const proxy = {
    "/rpc": {
      target: proxyTarget,
      changeOrigin: true
    }
  }

  return {
    plugins: [vue()],
    envDir: repoRoot,
    define: {
      __OTBOR_API_URL__: JSON.stringify(configured)
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy
    }
  }
})
