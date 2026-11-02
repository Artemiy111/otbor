import type { VacancyDraft } from "@otbor/contract"
import {
  classifyCrawlBlock,
  CrawlerError,
  ensureEngine,
  fetchHtml,
  loadProxyConfig,
  proxyForUrl,
  type ProxyConfig
} from "@otbor/crawler"
import { extractVacancy } from "@otbor/hh"
import { Effect } from "effect"

/** Typed crawler failure; unexpected values are wrapped, never rethrown raw. */
export const asCrawlerError = (code: CrawlerError["code"], error: unknown): CrawlerError =>
  error instanceof CrawlerError
    ? error
    : new CrawlerError({
        code,
        message: error instanceof Error ? error.message : String(error)
      })

export interface ProxyRuntime {
  readonly config: ProxyConfig | null
  readonly proxy: string | null
}

/**
 * Loads local proxy settings and, for a subscription, makes sure the mihomo
 * engine is running. An already running `OTBOR_PROXY_URL` is used as is: the
 * crawler and hydration work without Docker in that mode.
 */
export const prepareProxy: Effect.Effect<ProxyRuntime, CrawlerError> = Effect.gen(function*() {
  const config = yield* Effect.try({
    try: () => loadProxyConfig(),
    catch: (error) => asCrawlerError("proxy", error)
  })

  if (config !== null && config.source === "subscription") {
    yield* Effect.tryPromise({
      try: () => ensureEngine(config),
      catch: (error) => asCrawlerError("proxy", error)
    })
  }

  return {
    config,
    proxy: config === null ? null : proxyForUrl(config, "https://hh.ru/")
  }
})

/** Fetches and extracts one vacancy page, or null when hh refuses it. */
export const fetchVacancyDraft = (
  externalId: string,
  proxy: string | null
): Effect.Effect<VacancyDraft | null> =>
  Effect.gen(function*() {
    const response = yield* Effect.tryPromise({
      try: () => fetchHtml(`https://hh.ru/vacancy/${externalId}`, { proxy }),
      catch: () => null
    }).pipe(Effect.match({ onFailure: () => null, onSuccess: (value) => value }))

    if (response === null || response.status !== 200) return null
    if (classifyCrawlBlock(response.status, response.html) !== null) return null

    return yield* extractVacancy(response.html, { url: response.url }).pipe(
      Effect.match({ onFailure: () => null, onSuccess: (value) => value })
    )
  })
