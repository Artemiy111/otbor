import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { runCrawl } from "../src/crawl.ts"
import type { SearchCard, SearchPage } from "../src/search.ts"

const card: SearchCard = {
  externalId: "1",
  title: "DevOps",
  url: "https://hh.ru/vacancy/1",
  companyExternalId: null,
  companyName: null,
  salaryFrom: null,
  salaryTo: null,
  salaryCurrency: null,
  salaryGross: null,
  salaryNegotiable: false,
  areaId: null,
  areaName: null,
  publishedAt: null,
  snippet: null,
  experienceCode: null,
  employmentForm: null,
  workFormats: [],
  workScheduleDays: [],
  workingHours: [],
  archived: false
}

const page = (index: number, hasNext: boolean): SearchPage => ({
  page: index,
  totalResults: 2,
  pagesTotal: 2,
  hasNext,
  cards: [card],
  criteria: {
    text: "devops",
    area: [],
    page: index,
    itemsOnPage: 20,
    orderBy: null,
    searchField: []
  }
})

describe("crawl loop", () => {
  test("walks pages until hasNext is false", async () => {
    let index = 0
    const saved: number[] = []

    const outcome = await Effect.runPromise(
      runCrawl({
        url: "https://hh.ru/search/vacancy?text=devops",
        maxPages: 5,
        delayMs: 0,
        jitter: false,
        fetchPage: () =>
          Effect.succeed({
            status: 200,
            url: "https://hh.ru/search/vacancy?text=devops",
            page: page(index, index === 0)
          }),
        savePage: (parsed) => {
          saved.push(parsed.page)
          index += 1
          return Effect.succeed({ inserted: 1, updated: 0, skipped: 0 })
        }
      })
    )

    expect(outcome.status).toBe("done")
    expect(outcome.pagesDone).toBe(2)
    expect(outcome.found).toBe(2)
    expect(outcome.inserted).toBe(2)
    expect(outcome.nextPage).toBe(2)
    expect(saved).toEqual([0, 1])
  })

  test("stops and preserves the cursor on a captcha", async () => {
    const outcome = await Effect.runPromise(
      runCrawl({
        url: "https://hh.ru/search/vacancy?text=devops",
        maxPages: 5,
        delayMs: 0,
        jitter: false,
        fetchPage: () =>
          Effect.succeed({
            status: 200,
            url: "https://hh.ru/search/vacancy?text=devops",
            page: null,
            blocked: "captcha"
          }),
        savePage: () => Effect.succeed({ inserted: 0, updated: 0, skipped: 0 })
      })
    )

    expect(outcome.status).toBe("stopped")
    expect(outcome.reason).toBe("captcha")
    expect(outcome.nextPage).toBe(0)
    expect(outcome.pagesDone).toBe(0)
  })

  test("retries 429 before giving up", async () => {
    let attempts = 0
    const outcome = await Effect.runPromise(
      runCrawl({
        url: "https://hh.ru/search/vacancy?text=devops",
        maxPages: 1,
        delayMs: 0,
        maxRetries: 1,
        jitter: false,
        fetchPage: () => {
          attempts += 1
          return Effect.succeed(
            attempts === 1
              ? { status: 429, url: "https://hh.ru/search/vacancy?text=devops" }
              : { status: 200, url: "https://hh.ru/search/vacancy?text=devops", page: page(0, false) }
          )
        },
        savePage: () => Effect.succeed({ inserted: 1, updated: 0, skipped: 0 })
      })
    )

    expect(attempts).toBe(2)
    expect(outcome.status).toBe("done")
    expect(outcome.pagesDone).toBe(1)
  })

  /** A fetch that serves `pages` pages, every one with a next link. */
  const endless = (inserted: ReadonlyArray<number>, extra: { stopWhenNoNew?: boolean; maxPages?: number } = {}) => {
    const fetched: number[] = []
    const run = Effect.runPromise(
      runCrawl({
        url: "https://hh.ru/search/vacancy?text=devops",
        maxPages: extra.maxPages ?? 10,
        stopWhenNoNew: extra.stopWhenNoNew,
        delayMs: 0,
        jitter: false,
        fetchPage: (url) => {
          const index = Number(new URL(url).searchParams.get("page") ?? 0)
          fetched.push(index)
          return Effect.succeed({
            status: 200,
            url,
            page: page(index, true)
          })
        },
        savePage: (parsed) =>
          Effect.succeed({ inserted: inserted[parsed.page] ?? 0, updated: 0, skipped: 0 })
      })
    )
    return { run, fetched }
  }

  test("stopWhenNoNew stops after the first page without a new vacancy", async () => {
    const { run, fetched } = endless([5, 2, 0, 9], { stopWhenNoNew: true })
    const outcome = await run

    expect(outcome.status).toBe("stopped")
    expect(outcome.reason).toBe("no_new")
    expect(outcome.pagesDone).toBe(3)
    expect(outcome.inserted).toBe(7)
    expect(fetched).toEqual([0, 1, 2])
  })

  test("without stopWhenNoNew the crawl keeps going up to maxPages", async () => {
    const { run, fetched } = endless([5, 0, 0], { maxPages: 4 })
    const outcome = await run

    expect(outcome.reason).toBe("max_pages")
    expect(outcome.pagesDone).toBe(4)
    expect(fetched).toEqual([0, 1, 2, 3])
  })

  test("a captcha on a later page stops the run and keeps the earlier pages", async () => {
    const saved: number[] = []
    const outcome = await Effect.runPromise(
      runCrawl({
        url: "https://hh.ru/search/vacancy?text=devops",
        maxPages: 5,
        delayMs: 0,
        jitter: false,
        stopWhenNoNew: true,
        fetchPage: (url) => {
          const index = Number(new URL(url).searchParams.get("page") ?? 0)
          return Effect.succeed(
            index === 2
              ? { status: 200, url, page: null, blocked: "captcha" as const }
              : { status: 200, url, page: page(index, true) }
          )
        },
        savePage: (parsed) => {
          saved.push(parsed.page)
          return Effect.succeed({ inserted: 1, updated: 0, skipped: 0 })
        }
      })
    )

    expect(outcome.status).toBe("stopped")
    expect(outcome.reason).toBe("captcha")
    expect(saved).toEqual([0, 1])
    expect(outcome.pagesDone).toBe(2)
  })
})
