import tailwindcss from "@tailwindcss/vite"
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
const srcRoot = fileURLToPath(new URL("./src", import.meta.url))

const OTLP_PATH = "/otlp"

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
    },
    "/employer-logo": {
      target: proxyTarget,
      changeOrigin: true
    }
  }

  // Телеметрия браузера идёт на тот же origin и проксируется в коллектор,
  // поэтому CORS не нужен, а адрес коллектора не попадает в бандл. Без
  // OTEL_EXPORTER_OTLP_ENDPOINT прокси нет и приложение ничего не шлёт.
  const otlpTarget = loadEnv(mode, repoRoot, "OTEL_EXPORTER_OTLP_")
    .OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ?? ""
  if (otlpTarget !== "") {
    Object.assign(proxy, {
      [OTLP_PATH]: {
        target: otlpTarget,
        changeOrigin: true,
        rewrite: (path: string) => path.slice(OTLP_PATH.length)
      }
    })
  }

  return {
    plugins: [vue(), tailwindcss()],
    envDir: repoRoot,
    resolve: {
      alias: {
        "@": srcRoot
      }
    },
    define: {
      __OTBOR_API_URL__: JSON.stringify(configured),
      __OTBOR_OTLP_URL__: JSON.stringify(otlpTarget === "" ? "" : OTLP_PATH)
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      proxy
    }
  }
})
