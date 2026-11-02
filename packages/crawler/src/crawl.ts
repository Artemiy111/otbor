import { Effect } from "effect"
import type { CrawlerError } from "./errors.ts"
import {
  classifyCrawlBlock,
  withPageParam,
  type CrawlBlock,
  type SearchPage
} from "./search.ts"

export interface FetchedPage {
  readonly status: number
  readonly url: string
  readonly page?: SearchPage | null
  readonly blocked?: CrawlBlock | null
}

export interface CrawlPageMeta {
  readonly page: number
  readonly url: string
  readonly totalResults: number
  readonly pagesTotal: number
}

export interface CrawlPageSaveResult {
  readonly inserted: number
  readonly updated: number
  readonly skipped: number
  readonly errors?: number
}

export interface CrawlEvent extends CrawlPageSaveResult {
  readonly page: number
  readonly pagesDone: number
  readonly found: number
  readonly totalResults: number
  readonly pagesTotal: number | null
  readonly nextPage: number
}

export interface CrawlOutcome {
  readonly status: "done" | "stopped" | "error"
  readonly reason: string | null
  readonly nextPage: number
  readonly pagesDone: number
  readonly found: number
  readonly inserted: number
  readonly updated: number
  readonly skipped: number
  readonly errors: number
  readonly totalResults: number
  readonly pagesTotal: number | null
}

export interface CrawlDeps {
  readonly url: string
  /** Zero-based page to start from (resume cursor). */
  readonly startPage?: number
  /** Safety limit for this run, default 20. */
  readonly maxPages?: number
  /** Pause between pages, default 1500 ms. */
  readonly delayMs?: number
  /** Retries on 429/5xx, default 2 (three attempts total). */
  readonly maxRetries?: number
  /** Base for exponential backoff, default 2000 ms. */
  readonly backoffMs?: number
  /** Randomises pauses and backoff; disable in tests. */
  readonly jitter?: boolean
  /** Relative spread of a random pause, 0..1; default 0.5 (±50%). */
  readonly jitterRatio?: number
  readonly fetchPage: (url: string) => Effect.Effect<FetchedPage, CrawlerError>
  readonly savePage: (
    page: SearchPage,
    meta: CrawlPageMeta
  ) => Effect.Effect<CrawlPageSaveResult, CrawlerError>
  readonly shouldStop?: () => boolean
  readonly onEvent?: (event: CrawlEvent) => Effect.Effect<void>
}

export const randomPauseMs = (baseMs: number, ratio = 0.5): number => {
  if (baseMs <= 0) return 0
  const spread = Math.min(Math.max(ratio, 0), 1)
  const min = baseMs * (1 - spread)
  const max = baseMs * (1 + spread)
  return Math.round(min + Math.random() * (max - min))
}

const pause = (baseMs: number, jitter: boolean, ratio: number): Effect.Effect<void> =>
  Effect.sleep(`${jitter ? randomPauseMs(baseMs, ratio) : Math.max(0, baseMs)} millis`)

/**
 * Sequential crawl loop. One request at a time, delay between pages,
 * exponential backoff on 429/5xx, stop on captcha/403/451. The caller gets
 * `nextPage` so a later run can resume exactly at the gap.
 */
export const runCrawl = (deps: CrawlDeps): Effect.Effect<CrawlOutcome> =>
  Effect.gen(function*() {
    const maxPages = Math.max(1, deps.maxPages ?? 20)
    const delayMs = Math.max(0, deps.delayMs ?? 1500)
    const maxRetries = Math.max(0, deps.maxRetries ?? 2)
    const backoffMs = Math.max(0, deps.backoffMs ?? 2000)
    const jitter = deps.jitter ?? true
    const jitterRatio = Math.min(Math.max(deps.jitterRatio ?? 0.5, 0), 1)

    let page = Math.max(0, deps.startPage ?? 0)
    let pagesDone = 0
    let totalResults = 0
    let pagesTotal: number | null = null
    const counters = { found: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 }

    const finish = (
      status: CrawlOutcome["status"],
      reason: string | null,
      nextPage: number
    ): CrawlOutcome => ({
      status,
      reason,
      nextPage,
      pagesDone,
      totalResults,
      pagesTotal,
      ...counters
    })

    while (pagesDone < maxPages) {
      if (deps.shouldStop?.() === true) {
        return finish("stopped", "cancelled", page)
      }

      let attempt = 0
      let fetched: FetchedPage | null = null

      for (;;) {
        const result = yield* deps.fetchPage(withPageParam(deps.url, page)).pipe(
          Effect.match({
            onFailure: (error) => ({ ok: false as const, error }),
            onSuccess: (value) => ({ ok: true as const, value })
          })
        )

        if (!result.ok) {
          if (attempt >= maxRetries) {
            return finish("stopped", result.error.code, page)
          }
          yield* pause(backoffMs * 2 ** attempt, jitter, jitterRatio)
          attempt += 1
          continue
        }

        const response = result.value
        if (response.status === 0 || response.status === 429 || response.status >= 500) {
          if (attempt >= maxRetries) {
            return finish(
              "stopped",
              response.status === 0 ? "network" : `http_${response.status}`,
              page
            )
          }
          yield* pause(backoffMs * 2 ** attempt, jitter, jitterRatio)
          attempt += 1
          continue
        }

        fetched = response
        break
      }

      if (fetched.blocked !== null && fetched.blocked !== undefined) {
        return finish("stopped", fetched.blocked, page)
      }
      if (fetched.status === 403) return finish("stopped", "forbidden", page)
      if (fetched.status !== 200) return finish("error", `http_${fetched.status}`, page)
      if (fetched.page === null || fetched.page === undefined) {
        return finish("error", "parse_error", page)
      }

      const parsed = fetched.page
      totalResults = Math.max(totalResults, parsed.totalResults)
      pagesTotal = parsed.pagesTotal
      counters.found += parsed.cards.length
      pagesDone += 1

      if (parsed.cards.length === 0) {
        return parsed.hasNext
          ? finish("stopped", "empty_page", page + 1)
          : finish("done", "last_page", page + 1)
      }

      const saved = yield* deps.savePage(parsed, {
        page,
        url: fetched.url,
        totalResults: parsed.totalResults,
        pagesTotal: parsed.pagesTotal
      }).pipe(
        Effect.match({
          onFailure: (error) => ({ ok: false as const, error }),
          onSuccess: (value) => ({ ok: true as const, value })
        })
      )

      if (!saved.ok) {
        counters.errors += 1
        return finish("error", saved.error.message, page)
      }

      counters.inserted += saved.value.inserted
      counters.updated += saved.value.updated
      counters.skipped += saved.value.skipped
      counters.errors += saved.value.errors ?? 0

      page += 1
      if (deps.onEvent !== undefined) {
        yield* deps.onEvent({
          page: parsed.page,
          pagesDone,
          found: counters.found,
          totalResults,
          pagesTotal,
          nextPage: page,
          ...saved.value
        })
      }

      if (!parsed.hasNext) return finish("done", "last_page", page)
      if (pagesDone >= maxPages) return finish("stopped", "max_pages", page)
      yield* pause(delayMs, jitter, jitterRatio)
    }

    return finish("stopped", "max_pages", page)
  })

/** Exports for callers that classify a raw response themselves. */
export { classifyCrawlBlock }
