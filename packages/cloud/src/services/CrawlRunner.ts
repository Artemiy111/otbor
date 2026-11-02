import type { ApiError, VacancyDraft } from "@otbor/contract"
import { InvalidInput } from "@otbor/contract"
import {
  canRotate,
  classifyCrawlBlock,
  CrawlerError,
  draftFromCard,
  ensureEngine,
  fetchHtml,
  loadProxyConfig,
  parseSearchHtml,
  proxyLabel,
  proxyForUrl,
  rotateProxy,
  runCrawl,
  type CrawlOutcome,
  type CrawlPageMeta,
  type CrawlPageSaveResult,
  type FetchedPage,
  type ProxyConfig,
  type SearchPage
} from "@otbor/crawler"
import { Context, Effect, Layer } from "effect"
import { CorpusService } from "./CorpusService.ts"
import { CrawlService } from "./CrawlService.ts"

export interface CrawlRunnerInput {
  /** The schedule owner; the run records are shared corpus, this is for logs. */
  readonly userId: string
  readonly url: string
  /** One page per scheduled run by default. */
  readonly maxPages?: number
  readonly delayMs?: number
  readonly startPage?: number
  readonly title?: string
}

export interface CrawlRunnerResult {
  readonly runId: string
  readonly status: CrawlOutcome["status"]
  readonly reason: string | null
  /** Null when the run completed normally; otherwise the schedule error text. */
  readonly error: string | null
  readonly pagesDone: number
  readonly found: number
  readonly inserted: number
  readonly updated: number
  readonly skipped: number
  readonly errors: number
}

export interface CrawlRunnerShape {
  readonly run: (input: CrawlRunnerInput) => Effect.Effect<CrawlRunnerResult, ApiError>
}

/**
 * The scheduled half of the crawler. It uses the same fetch/parse helpers as
 * `otbor crawl`, but it is bounded to one page by default so a schedule never
 * turns into an unbounded crawl inside the worker.
 *
 * Proxy settings stay local secrets: the endpoint (or the mihomo engine for a
 * subscription) is prepared here and never stored or logged in full.
 */
export class CrawlRunner extends Context.Service<CrawlRunner, CrawlRunnerShape>()(
  "otbor/cloud/CrawlRunner"
) {
  static readonly layer = Layer.effect(
    CrawlRunner,
    Effect.gen(function*() {
      const crawl = yield* CrawlService
      const corpus = yield* CorpusService

      const prepareProxy = Effect.gen(function*() {
        const config = yield* Effect.try({
          try: () => loadProxyConfig(),
          catch: (error) =>
            new InvalidInput({
              message: `proxy config: ${error instanceof Error ? error.message : String(error)}`
            })
        })

        if (config !== null && config.source === "subscription") {
          yield* Effect.tryPromise({
            try: () => ensureEngine(config),
            catch: (error) =>
              new InvalidInput({
                message: `proxy engine: ${error instanceof Error ? error.message : String(error)}`
              })
          })
        }

        return config
      })

      const proxyFor = (config: ProxyConfig | null, url: string) =>
        Effect.try({
          try: () => proxyForUrl(config, url),
          catch: (error) =>
            new InvalidInput({
              message: error instanceof Error ? error.message : String(error)
            })
        })

      const run = Effect.fn("CrawlRunner.run")(function*(input: CrawlRunnerInput) {
        const config = yield* prepareProxy
        const proxy = yield* proxyFor(config, input.url)
        const maxPages = Math.max(1, input.maxPages ?? 1)
        const delayMs = Math.max(0, input.delayMs ?? 750)

        const started = yield* crawl.start({
          url: input.url,
          startPage: input.startPage ?? 0,
          title: input.title
        })
        const runId = started.runId
        yield* Effect.logInfo(
          `scheduled crawl ${runId} for ${input.userId}: ${input.url} via ${proxyLabel(config)}`
        )

        let rotations = 0

        const fetchOnce = (pageUrl: string) =>
          Effect.gen(function*() {
            const response = yield* Effect.tryPromise({
              try: () => fetchHtml(pageUrl, { proxy }),
              catch: (error) => asCrawlerError("network", error)
            })
            const blocked = classifyCrawlBlock(response.status, response.html)

            if (blocked === null) {
              const parsed = yield* Effect.try({
                try: () => parseSearchHtml(response.html),
                catch: (error) => asCrawlerError("search_state_invalid", error)
              })
              return {
                status: response.status,
                url: response.url,
                page: parsed
              } satisfies FetchedPage
            }

            return {
              status: response.status,
              url: response.url,
              page: null,
              blocked
            } satisfies FetchedPage
          })

        const fetchPage = (pageUrl: string): Effect.Effect<FetchedPage, CrawlerError> =>
          Effect.gen(function*() {
            const first = yield* fetchOnce(pageUrl)
            if (
              first.blocked === null ||
              first.blocked === undefined ||
              !canRotate(config) ||
              rotations >= config.maxRotations
            ) {
              return first
            }

            const rotated = yield* Effect.tryPromise({
              try: () => rotateProxy(config),
              catch: (error) => asCrawlerError("proxy", error)
            }).pipe(Effect.match({ onFailure: () => null, onSuccess: (value) => value }))

            if (rotated === null) return first
            rotations += 1
            return yield* fetchOnce(pageUrl)
          })

        let pagesDone = 0
        let found = 0

        const savePage = (
          page: SearchPage,
          meta: CrawlPageMeta
        ): Effect.Effect<CrawlPageSaveResult, CrawlerError> =>
          Effect.gen(function*() {
            const drafts: ReadonlyArray<VacancyDraft> = page.cards.map(draftFromCard)
            const saved = yield* corpus.ingest(drafts).pipe(
              Effect.mapError((error) => asCrawlerError("network", error))
            )

            pagesDone += 1
            found += page.cards.length

            yield* crawl.savePage({
              runId: runId,
              nextPage: meta.page + 1,
              pagesDone,
              found,
              vacancyIds: saved.items.map((item) => item.id)
            }).pipe(Effect.mapError((error) => asCrawlerError("network", error)))

            return {
              inserted: saved.inserted,
              updated: saved.updated,
              skipped: saved.skipped,
              errors: 0
            }
          })

        const outcome = yield* runCrawl({
          url: input.url,
          startPage: input.startPage ?? 0,
          maxPages,
          delayMs,
          fetchPage,
          savePage
        })

        const error = failureReason(outcome)
        yield* crawl.finish({
          runId,
          status: outcome.status,
          nextPage: outcome.nextPage,
          pagesDone: outcome.pagesDone,
          found: outcome.found,
          error
        })

        return {
          runId,
          status: outcome.status,
          reason: outcome.reason,
          error,
          pagesDone: outcome.pagesDone,
          found: outcome.found,
          inserted: outcome.inserted,
          updated: outcome.updated,
          skipped: outcome.skipped,
          errors: outcome.errors
        }
      })

      return CrawlRunner.of({ run })
    })
  )
}

/** A bounded run stops for a normal reason; only real failures reach `last_error`. */
export const failureReason = (outcome: CrawlOutcome): string | null => {
  if (outcome.status === "done") return null
  if (outcome.status === "stopped") {
    if (
      outcome.reason === null ||
      outcome.reason === "max_pages" ||
      outcome.reason === "empty_page" ||
      outcome.reason === "last_page" ||
      outcome.reason === "cancelled"
    ) {
      return null
    }
  }
  return outcome.reason ?? "crawl stopped without a reason"
}

const asCrawlerError = (code: CrawlerError["code"], error: unknown): CrawlerError =>
  error instanceof CrawlerError
    ? error
    : new CrawlerError({
        code,
        message: error instanceof Error ? error.message : String(error)
      })
