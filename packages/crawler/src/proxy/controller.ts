/** mihomo REST API client: selector state, switching and latency probes. */

import { pickNextNodes, workerProxyConfig, type ProxyConfig } from "./config"

export interface SelectorState {
  readonly current: string | null
  readonly all: ReadonlyArray<string>
}

export interface RotationResult {
  readonly node: string
  /** Measured latency, or null when the provider reports no delay. */
  readonly delay: number | null
  readonly previous: string | null
}

export class ProxyApiError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "ProxyApiError"
  }
}

export const engineHealthy = async (
  config: ProxyConfig,
  timeoutMs = 2000
): Promise<boolean> => {
  if (config.controller === null) return false
  try {
    const response = await fetch(`${trimSlash(config.controller)}/version`, {
      headers: headers(config),
      signal: AbortSignal.timeout(timeoutMs)
    })
    return response.ok
  } catch {
    return false
  }
}

export const proxyState = async (config: ProxyConfig): Promise<SelectorState> => {
  const response = await api(config, `/proxies/${encodeURIComponent(config.group)}`)
  const data = (await response.json()) as { now?: unknown; all?: unknown }
  if (!Array.isArray(data.all)) {
    throw new ProxyApiError(
      `mihomo не вернул список нод для группы «${config.group}». Проверьте подписку.`
    )
  }
  const all = data.all.filter((name): name is string => typeof name === "string")
  return {
    current: typeof data.now === "string" ? data.now : null,
    all
  }
}

export const selectProxyNode = async (config: ProxyConfig, name: string): Promise<void> => {
  await api(config, `/proxies/${encodeURIComponent(config.group)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  })
}

/**
 * Gives every worker its own node, so no two workers start on one exit IP.
 * Nodes come from the selector list; dead ones are replaced on the first
 * block by `rotateProxy`. Returns the node per worker (fewer nodes than
 * workers means some workers share an IP, in list order).
 */
export const assignWorkerNodes = async (
  config: ProxyConfig,
  workers: number
): Promise<ReadonlyArray<string>> => {
  if (config.source !== "subscription") return []
  const state = await proxyState(config)
  const pool = pickNextNodes(state.all, null, state.all.length).filter(
    (name) => !/авто|auto/i.test(name)
  )
  if (pool.length === 0) return []
  const chosen: string[] = []
  for (let index = 0; index < workers; index += 1) {
    const node = pool[index % pool.length]!
    await selectProxyNode(workerProxyConfig(config, index), node)
    chosen.push(node)
  }
  return chosen
}

export interface ProviderInfo {
  readonly nodes: ReadonlyArray<{ readonly name: string; readonly alive: boolean | null }>
  /** From the subscription's `subscription-userinfo`; null when the provider omits it. */
  readonly usedBytes: number | null
  readonly totalBytes: number | null
  readonly expiresAt: string | null
}

/** Provider health-check results and subscription quota, without touching hh.ru. */
export const providerInfo = async (
  config: ProxyConfig,
  provider = "otbor-sub"
): Promise<ProviderInfo> => {
  const response = await api(config, `/providers/proxies/${encodeURIComponent(provider)}`)
  const data = (await response.json()) as { proxies?: unknown; subscriptionInfo?: unknown }
  const nodes = Array.isArray(data.proxies)
    ? data.proxies.flatMap((item) => {
        if (item === null || typeof item !== "object") return []
        const name = (item as { name?: unknown }).name
        if (typeof name !== "string") return []
        const alive = (item as { alive?: unknown }).alive
        return [{ name, alive: typeof alive === "boolean" ? alive : null }]
      })
    : []

  const info = (data.subscriptionInfo ?? {}) as Record<string, unknown>
  const num = (...keys: ReadonlyArray<string>): number | null => {
    for (const key of keys) {
      const value = info[key]
      if (typeof value === "number" && Number.isFinite(value)) return value
    }
    return null
  }
  const upload = num("Upload", "upload")
  const download = num("Download", "download")
  const total = num("Total", "total")
  const expire = num("Expire", "expire")
  return {
    nodes,
    usedBytes: upload === null && download === null ? null : (upload ?? 0) + (download ?? 0),
    totalBytes: total === null || total === 0 ? null : total,
    expiresAt: expire === null || expire === 0 ? null : new Date(expire * 1000).toISOString()
  }
}

const CANARY_URL = "https://hh.ru/"

/**
 * Real egress check through the local mixed port, against hh.ru itself.
 *
 * `/proxies/<name>/delay` does not work for nodes that come from a proxy
 * provider (mihomo answers "Resource not found"), so the only reliable probe
 * is a request through the proxy after selecting the node. The target must be
 * hh.ru: a node can answer gstatic and still be geo-blocked by hh (HTTP 451).
 */
export const probeThroughProxy = async (
  config: ProxyConfig,
  timeoutMs = 6000
): Promise<number | null> => {
  if (!/^https?:\/\//i.test(config.url)) return null

  // hh.ru occasionally answers 451 in a burst even for a good IP, so one
  // failed attempt must not discard the node.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = performance.now()
    try {
      const response = await fetch(CANARY_URL, {
        proxy: config.url,
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (response.ok) return Math.round(performance.now() - started)
    } catch {
      // fall through to the retry
    }
    if (attempt === 0) await sleep(300)
  }
  return null
}

/**
 * The provider downloads the subscription after the engine starts, so the
 * selector can be empty for a few seconds. Rotation must wait for it instead
 * of reporting "no live nodes".
 */
export const waitForNodes = async (
  config: ProxyConfig,
  timeoutMs = 15_000
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const state = await proxyState(config).catch(() => null)
    if (state !== null && state.all.length > 0) return true
    if (Date.now() >= deadline) return false
    await sleep(500)
  }
}

export interface RotateOptions {
  /** How many nodes to try before giving up. */
  readonly probes?: number
  /** Timeout for one egress probe. */
  readonly delayTimeoutMs?: number
  /** Test seam: measures the currently selected node. */
  readonly probe?: () => Promise<number | null>
}

/**
 * Switch to the next node that actually answers. Rotation is a last resort
 * after a captcha, so a dead node must not replace a working one: on total
 * failure the previous node is restored.
 */
export const rotateProxy = async (
  config: ProxyConfig,
  options: RotateOptions = {}
): Promise<RotationResult | null> => {
  const state = await proxyState(config)
  const candidates = pickNextNodes(state.all, state.current, options.probes ?? 6)
  const probe = options.probe ?? (() => probeThroughProxy(config, options.delayTimeoutMs))

  for (const node of candidates) {
    await selectProxyNode(config, node)
    const delay = await probe()
    if (delay !== null) return { node, delay, previous: state.current }
  }

  if (state.current !== null) {
    await selectProxyNode(config, state.current).catch(() => {})
  }
  return null
}

const api = async (
  config: ProxyConfig,
  path: string,
  init: RequestInit = {}
): Promise<Response> => {
  if (config.controller === null) {
    throw new ProxyApiError("Не задан OTBOR_PROXY_CONTROLLER: ротация недоступна.")
  }
  const controller = trimSlash(config.controller)

  const response = await fetch(`${controller}${path}`, {
    ...init,
    headers: { ...headers(config), ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(5000)
  }).catch((error: unknown) => {
    throw new ProxyApiError(
      `mihomo недоступен на ${controller}. Запустите \`otbor proxy up\`.`,
      { cause: error }
    )
  })

  if (!response.ok) {
    throw new ProxyApiError(`mihomo ответил HTTP ${response.status} на ${path}.`)
  }
  return response
}

const headers = (config: ProxyConfig): Record<string, string> =>
  config.secret === null ? {} : { Authorization: `Bearer ${config.secret}` }

const trimSlash = (value: string): string => value.replace(/\/+$/, "")

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
