/**
 * Proxy settings for hh.ru requests.
 *
 * Two shapes are supported:
 * - `OTBOR_PROXY_URL` — an already running local proxy (Clash Verge, mihomo
 *   on another port, a corporate gateway). Nothing is started.
 * - `OTBOR_PROXY_SUB_URL` — a subscription link. `otbor proxy up` runs mihomo
 *   in Docker and exposes its mixed port on loopback.
 *
 * A subscription link is a list of server configs, not an endpoint: browsers
 * and `fetch` cannot use it directly. That is why the second shape needs the
 * local engine. The URL usually contains an access token, so it is a secret.
 */

import {
  DEFAULT_CONTROLLER_PORT,
  DEFAULT_MAX_ROTATIONS,
  DEFAULT_PROXY_GROUP,
  DEFAULT_PROXY_PORT,
  DEFAULT_PROXY_SECRET
} from "./constants"
import { readProxyFile, type ProxyFileConfig } from "./store"

export type ProxyRotate = "off" | "captcha"
export type ProxySource = "endpoint" | "subscription"

export {
  DEFAULT_CONTROLLER_PORT,
  DEFAULT_MAX_ROTATIONS,
  DEFAULT_PROXY_GROUP,
  DEFAULT_PROXY_PORT,
  DEFAULT_PROXY_SECRET
}

export interface ProxyConfig {
  /** Local mixed HTTP port used by `fetch`. */
  readonly url: string
  readonly source: ProxySource
  /** Full subscription URL. Never log it: it contains credentials. */
  readonly subscriptionUrl: string | null
  /** mihomo REST API; rotation is impossible without it. */
  readonly controller: string | null
  readonly secret: string | null
  /** Selector group the rotation switches. */
  readonly group: string
  readonly rotate: ProxyRotate
  readonly maxRotations: number
  /** Where the settings came from, for `otbor proxy status`. */
  readonly origin: "env" | "file"
}


const GROUP_RE = /^[A-Za-z0-9_-]{1,32}$/

/** Runtime entry point: saved file first, environment overrides per field. */
export const loadProxyConfig = (
  env: Record<string, string | undefined> = process.env,
  file: ProxyFileConfig | null = readProxyFile()
): ProxyConfig | null => resolveProxyConfig(env, file)

const envValue = (
  env: Record<string, string | undefined>,
  name: string
): string | null => {
  const own = text(env[`OTBOR_PROXY_${name}`])
  if (own !== null) return own
  return text(env[`HHX_PROXY_${name}`])
}

/** Pure resolution, used by tests and by `otbor proxy set` previews. */
export const resolveProxyConfig = (
  env: Record<string, string | undefined>,
  file: ProxyFileConfig | null
): ProxyConfig | null => {
  const endpoint = envValue(env, "URL") ?? text(file?.url)
  const subscription = envValue(env, "SUB_URL") ?? text(file?.subscriptionUrl)
  if (endpoint === null && subscription === null) return null

  const fromEnv =
    envValue(env, "URL") !== null || envValue(env, "SUB_URL") !== null
  const group = envValue(env, "GROUP") ?? text(file?.group) ?? DEFAULT_PROXY_GROUP
  if (!GROUP_RE.test(group)) {
    throw new Error(
      `Группа прокси: допустимы латиница, цифры, «_» и «-» (получено «${group}»).`
    )
  }

  const rotate = parseRotate(envValue(env, "ROTATE") ?? text(file?.rotate))
  const maxRotations = parseCount(
    envValue(env, "MAX_ROTATIONS") ?? numberText(file?.maxRotations),
    DEFAULT_MAX_ROTATIONS
  )
  const controller = envValue(env, "CONTROLLER") ?? text(file?.controller)
  const secret = envValue(env, "SECRET") ?? text(file?.secret)
  const controllerUrl =
    controller === null ? null : normalizeUrl(controller, "Контроллер mihomo")

  if (endpoint !== null) {
    return {
      url: normalizeUrl(endpoint, "Адрес прокси"),
      source: "endpoint",
      subscriptionUrl: null,
      controller: controllerUrl,
      secret,
      group,
      rotate,
      maxRotations,
      origin: fromEnv ? "env" : "file"
    }
  }
  if (subscription === null) return null

  const port = parsePort(
    envValue(env, "PORT") ?? numberText(file?.port),
    DEFAULT_PROXY_PORT,
    "Порт прокси"
  )
  const controllerPort = parsePort(
    envValue(env, "CONTROLLER_PORT") ?? numberText(file?.controllerPort),
    DEFAULT_CONTROLLER_PORT,
    "Порт контроллера"
  )

  return {
    url: `http://127.0.0.1:${port}`,
    source: "subscription",
    subscriptionUrl: normalizeSubscription(subscription),
    controller: controllerUrl ?? `http://127.0.0.1:${controllerPort}`,
    secret: secret ?? DEFAULT_PROXY_SECRET,
    group,
    rotate,
    maxRotations,
    origin: fromEnv ? "env" : "file"
  }
}

/** Rotation needs both a switchable engine and an explicit opt-in. */
export const canRotate = (config: ProxyConfig | null): config is ProxyConfig =>
  Boolean(config && config.rotate === "captcha" && config.controller)

/**
 * Bun `fetch` understands HTTP proxies only. SOCKS is browser-only, and
 * silently going direct would leak the real IP, so it is an error here.
 */
export const fetchProxyUrl = (config: ProxyConfig | null): string | null => {
  if (config === null) return null
  if (/^https?:\/\//i.test(config.url)) return config.url
  throw new Error(
    `Прокси ${config.url} не HTTP: серверный fetch (Bun) умеет только http(s). ` +
      "Укажите HTTP/mixed-порт в OTBOR_PROXY_URL."
  )
}

/** Loopback is never proxied: local RPC, tests and pet projects stay direct. */
export const shouldProxyUrl = (url: string): boolean => {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return true
  }
  return !(
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost")
  )
}

/** Proxy for one request, or null when the destination is local. */
export const proxyForUrl = (
  config: ProxyConfig | null,
  url: string
): string | null => {
  if (!shouldProxyUrl(url)) return null
  return fetchProxyUrl(config)
}

/** `127.0.0.1:17890` — safe for logs and UI. */
export const proxyLabel = (config: ProxyConfig | null): string => {
  if (config === null) return "напрямую"
  try {
    return new URL(config.url).host
  } catch {
    return config.url
  }
}

/** Subscription origin without the token-bearing path and query. */
export const maskSubscription = (url: string | null): string | null => {
  if (url === null) return null
  try {
    return new URL(url).origin
  } catch {
    return "подписка"
  }
}

/** Ordered rotation candidates: the node after the current one, then around. */
export const pickNextNodes = (
  all: ReadonlyArray<string>,
  current: string | null,
  limit = 4
): ReadonlyArray<string> => {
  const reserved = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE", "GLOBAL"])
  const usable = all.filter((name) => !reserved.has(name) && name !== current)
  if (usable.length === 0) return []

  const anchor = current === null ? -1 : all.indexOf(current)
  const after = anchor < 0 ? usable : usable.filter((name) => all.indexOf(name) > anchor)
  const before = anchor < 0 ? [] : usable.filter((name) => all.indexOf(name) < anchor)
  return [...after, ...before].slice(0, Math.max(1, limit))
}

const text = (value: string | undefined | null): string | null => {
  const trimmed = value?.trim()
  return trimmed !== undefined && trimmed !== "" ? trimmed : null
}

const numberText = (value: number | undefined): string | null =>
  value === undefined ? null : String(value)

const normalizeUrl = (value: string, name: string): string => {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error(`${name}: некорректный адрес «${value}».`)
  }
  if (url.pathname === "/" && !url.search && !url.hash) return url.origin
  return url.toString()
}

const normalizeSubscription = (value: string): string => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Ссылка подписки: некорректный адрес «${value}».`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Ссылка подписки: нужен http(s), получено «${url.protocol}».`)
  }
  return url.toString()
}

const parsePort = (raw: string | null, fallback: number, name: string): number => {
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name}: ожидается порт 1–65535 (получено «${raw}»).`)
  }
  return value
}

const parseCount = (raw: string | null, fallback: number): number => {
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 20) {
    throw new Error(`Лимит смен IP: ожидается 0–20 (получено «${raw}»).`)
  }
  return value
}

const parseRotate = (raw: string | null): ProxyRotate => {
  if (raw === null) return "captcha"
  if (raw === "off" || raw === "captcha") return raw
  throw new Error(`Ротация: ожидается off или captcha (получено «${raw}»).`)
}
