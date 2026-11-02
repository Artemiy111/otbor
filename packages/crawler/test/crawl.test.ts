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
})
