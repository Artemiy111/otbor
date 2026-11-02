/**
 * Docker lifecycle for the subscription case.
 *
 * The engine is an implementation detail: callers only know a loopback port.
 * Everything here is idempotent so that any command can call `ensureEngine`
 * before touching hh.ru.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  DEFAULT_CONTROLLER_PORT,
  DEFAULT_PROXY_PORT,
  DEFAULT_PROXY_SECRET
} from "./constants"
import type { ProxyConfig } from "./config"
import { renderMihomoConfig } from "./mihomo"
import { engineHealthy } from "./controller"

const ROOT = resolve(import.meta.dirname, "../../../../")

export const MIHOMO_DIR =
  process.env.OTBOR_MIHOMO_DIR?.trim() || join(ROOT, "data/mihomo")
export const PROXY_COMPOSE = join(ROOT, "compose.proxy.yml")
export const PROXY_CONTAINER = "otbor-mihomo"

export interface EnginePorts {
  readonly port: number
  readonly controllerPort: number
}

/**
 * Ports inside the container are fixed: the compose file publishes them to
 * the host ports from ProxyConfig. Mixing the two would make mihomo listen on
 * a port Docker never forwards.
 */
export const CONTAINER_MIXED_PORT = 7890
export const CONTAINER_CONTROLLER_PORT = 9090

export const enginePorts = (config: ProxyConfig): EnginePorts => ({
  port: urlPort(config.url, DEFAULT_PROXY_PORT),
  controllerPort: urlPort(config.controller ?? "", DEFAULT_CONTROLLER_PORT)
})

/** Writes `data/mihomo/config.yaml`; returns its path. */
export const writeEngineConfig = (
  config: ProxyConfig,
  dir = MIHOMO_DIR
): string => {
  if (config.source !== "subscription" || config.subscriptionUrl === null) {
    throw new Error("Конфиг mihomo пишется только для прокси из подписки.")
  }
  mkdirSync(join(dir, "providers"), { recursive: true })
  const path = join(dir, "config.yaml")
  writeFileSync(
    path,
    renderMihomoConfig({
      subscriptionUrl: config.subscriptionUrl,
      port: CONTAINER_MIXED_PORT,
      controllerPort: CONTAINER_CONTROLLER_PORT,
      secret: config.secret ?? DEFAULT_PROXY_SECRET,
      group: config.group
    })
  )
  return path
}

/** Starts the container when it is not already answering. No-op otherwise. */
export const ensureEngine = async (
  config: ProxyConfig,
  options: { readonly timeoutMs?: number } = {}
): Promise<void> => {
  if (config.source !== "subscription") return
  if (await engineHealthy(config, 1500)) return
  await startEngine(config, options)
}

/**
 * Rewrites the config and recreates the container: mihomo reads the mounted
 * file only at start, so a new subscription would otherwise be ignored.
 */
export const startEngine = async (
  config: ProxyConfig,
  options: { readonly timeoutMs?: number } = {}
): Promise<void> => {
  if (config.source !== "subscription") return
  writeEngineConfig(config)

  await compose(config, ["up", "-d", "--force-recreate"]).catch((error: unknown) => {
    throw new Error(
      `Не удалось запустить mihomo в Docker: ${messageOf(error)}. ` +
        "Проверьте, что Docker запущен, или задайте готовый OTBOR_PROXY_URL."
    )
  })

  const timeoutMs = options.timeoutMs ?? 30_000
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await engineHealthy(config, 1000)) return
    await sleep(500)
  }

  throw new Error(
    `mihomo не ответил на ${config.controller} за ${Math.round(timeoutMs / 1000)} с. ` +
      `Логи: docker logs ${PROXY_CONTAINER}`
  )
}

export const stopEngine = async (): Promise<void> => {
  await compose(null, ["down"])
}

/** mihomo version string, or null when the controller is unreachable. */
export const engineVersion = async (config: ProxyConfig): Promise<string | null> => {
  if (config.controller === null) return null
  try {
    const response = await fetch(`${config.controller.replace(/\/+$/, "")}/version`, {
      headers: config.secret === null ? {} : { Authorization: `Bearer ${config.secret}` },
      signal: AbortSignal.timeout(2000)
    })
    if (!response.ok) return null
    const data = (await response.json()) as { version?: unknown }
    return typeof data.version === "string" ? data.version : null
  } catch {
    return null
  }
}

const compose = async (config: ProxyConfig | null, args: ReadonlyArray<string>): Promise<string> => {
  const ports = config === null
    ? { port: DEFAULT_PROXY_PORT, controllerPort: DEFAULT_CONTROLLER_PORT }
    : enginePorts(config)

  const proc = Bun.spawn(["docker", "compose", "-f", PROXY_COMPOSE, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      OTBOR_PROXY_PORT: String(ports.port),
      OTBOR_PROXY_CONTROLLER_PORT: String(ports.controllerPort)
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe"
  })

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ])

  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `docker compose завершился с кодом ${code}`)
  }
  return stdout
}

const urlPort = (value: string, fallback: number): number => {
  try {
    const port = Number(new URL(value).port)
    return Number.isInteger(port) && port > 0 ? port : fallback
  } catch {
    return fallback
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
