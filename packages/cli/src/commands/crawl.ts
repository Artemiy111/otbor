import type { VacancyDraft } from "@otbor/contract"
import {
  canRotate,
  classifyCrawlBlock,
  draftFromCard,
  fetchHtml,
  parseSearchHtml,
  proxyLabel,
  rotateProxy,
  runCrawl,
  type CrawlerError,
  type CrawlEvent,
  type CrawlPageMeta,
  type FetchedPage,
  type SearchPage
} from "@otbor/crawler"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Api } from "../client.ts"
import { table } from "../format.ts"
import { asCrawlerError, fetchVacancyDraft, prepareProxy } from "../hh-fetch.ts"

const crawl = Command.make(
  "crawl",
  {
    url: Argument.String("url").pipe(
      Argument.withDescription("hh.ru search URL, e.g. https://hh.ru/search/vacancy?text=devops&area=1")
    ),
    pages: Flag.Int("pages").pipe(
      Flag.withDescription("Maximum pages in this run"),
      Flag.withDefault(1)
    ),
    start: Flag.Int("start-page").pipe(
      Flag.withDescription("Zero-based page to resume from"),
      Flag.withDefault(0)
    ),
    delay: Flag.Int("delay").pipe(
      Flag.withDescription("Base pause between pages, milliseconds"),
      Flag.withDefault(1500)
    ),
    hydrate: Flag.Boolean("hydrate").pipe(
      Flag.withDescription("Fetch the full vacancy page for every card"),
      Flag.withDefault(false)
    ),
    hydrateLimit: Flag.Int("hydrate-limit").pipe(
      Flag.withDescription("Hydrate at most N cards per page"),
      Flag.optional
    ),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false))
  },
  Effect.fn(function*({ url, pages, start, delay, hydrate, hydrateLimit, json }) {
    const api = yield* Api
    const { config, proxy } = yield* prepareProxy
    let rotations = 0

    const crawlRun = yield* api.CrawlStart({ url, startPage: start })

    const fetchOnce = (pageUrl: string): Effect.Effect<FetchedPage, CrawlerError> =>
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
          return { status: response.status, url: response.url, page: parsed }
        }

        return { status: response.status, url: response.url, page: null, blocked }
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
    let inserted = 0
    let updated = 0
    let skipped = 0

    const savePage = (
      page: SearchPage,
      meta: CrawlPageMeta
    ): Effect.Effect<{ inserted: number; updated: number; skipped: number; errors: number }, CrawlerError> =>
      Effect.gen(function*() {
        const stubs = page.cards.map(draftFromCard)
        const saved = yield* api.VacanciesUpsert({ drafts: stubs }).pipe(
          Effect.mapError((error) => asCrawlerError("network", error))
        )
        const vacancyIds = new Set(saved.items.map((item) => item.id))

        let errors = 0
        if (hydrate && page.cards.length > 0) {
          const hydrated: Array<VacancyDraft> = []
          const limit = Option.getOrUndefined(hydrateLimit)
          const cards = limit === undefined
            ? page.cards
            : page.cards.slice(0, Math.max(0, limit))

          for (const card of cards) {
            const draft = yield* fetchVacancyDraft(card.externalId, proxy)
            if (draft === null) {
              errors += 1
            } else {
              hydrated.push(draft)
            }
            yield* Effect.sleep("400 millis")
          }

          if (hydrated.length > 0) {
            const stored = yield* api.VacanciesUpsert({ drafts: hydrated }).pipe(
              Effect.mapError((error) => asCrawlerError("network", error))
            )
            for (const item of stored.items) vacancyIds.add(item.id)
          }
        }

        pagesDone += 1
        found += page.cards.length
        inserted += saved.inserted
        updated += saved.updated
        skipped += saved.skipped

        yield* api.CrawlSavePage({
          runId: crawlRun.runId,
          nextPage: meta.page + 1,
          pagesDone,
          found,
          currentPage: page.page,
          pagesTotal: page.pagesTotal,
          inserted,
          updated,
          skipped,
          vacancyIds: [...vacancyIds]
        }).pipe(Effect.mapError((error) => asCrawlerError("network", error)))

        return {
          inserted: saved.inserted,
          updated: saved.updated,
          skipped: saved.skipped,
          errors
        }
      })

    const onEvent = (event: CrawlEvent): Effect.Effect<void> =>
      Console.log(
        `page ${event.page + 1}/${event.pagesTotal ?? "?"} · found ${event.found}` +
          ` · new ${event.inserted} · updated ${event.updated}` +
          ` · unchanged ${event.skipped}` +
          ((event.errors ?? 0) > 0 ? ` · errors ${event.errors}` : "")
      )

    const outcome = yield* runCrawl({
      url,
      startPage: start,
      maxPages: pages,
      delayMs: delay,
      fetchPage,
      savePage,
      onEvent
    })

    const finished = yield* api.CrawlFinish({
      runId: crawlRun.runId,
      status: outcome.status,
      nextPage: outcome.nextPage,
      pagesDone: outcome.pagesDone,
      found: outcome.found,
      inserted: outcome.inserted,
      updated: outcome.updated,
      skipped: outcome.skipped,
      error: outcome.status === "done" ? null : outcome.reason
    })

    if (json) {
      yield* Console.log(
        JSON.stringify({ proxy: proxyLabel(config), rotations, run: finished, outcome }, null, 2)
      )
      return
    }

    if (config !== null) {
      yield* Console.log(`proxy:   ${proxyLabel(config)} (${config.source})`)
    }
    yield* Console.log(`run:     ${finished.runId}`)
    yield* Console.log(`status:  ${outcome.status}${outcome.reason === null ? "" : ` (${outcome.reason})`}`)
    yield* Console.log(`pages:   ${outcome.pagesDone}`)
    yield* Console.log(`found:   ${outcome.found}`)
    yield* Console.log(
      table(
        ["inserted", "updated", "skipped", "errors", "next page"],
        [[
          `${outcome.inserted}`,
          `${outcome.updated}`,
          `${outcome.skipped}`,
          `${outcome.errors}`,
          `${outcome.nextPage}`
        ]]
      )
    )

    if (
      outcome.status === "error" ||
      (outcome.status === "stopped" &&
        outcome.reason !== "max_pages" &&
        outcome.reason !== "empty_page" &&
        outcome.reason !== "cancelled")
    ) {
      process.exitCode = 3
    }
  })
).pipe(Command.withDescription("Crawl hh.ru search pages and store vacancies, employers and skills"))

export const crawlCommand = crawl

export { crawl as crawlRun }
