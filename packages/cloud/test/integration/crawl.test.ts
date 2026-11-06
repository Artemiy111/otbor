/** Integration: crawl. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import {
  crawlFinish,
  crawlRunsList,
  crawlSavePage,
  crawlSavePageFailure,
  crawlStart,
  crawlStatus,
  createTestDatabase,
  dropTestDatabase,
  findSearchQuery,
  integrationEnabled,
  migrateTestDatabase,
  searchHitsFor,
  searchRunRowsFor,
  seedTenant,
  seedVacancy,
  serverUrl,
  testDatabaseUrl
} from "./support/index.ts"

if (!integrationEnabled || serverUrl === null) {
  test("cloud integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    // Documented in test/integration/README.md and root `bun run test:integration`.
    expect(integrationEnabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  beforeAll(async () => {
    await createTestDatabase(base)
    await migrateTestDatabase(base)
    // `Database.layer` reads DATABASE_URL when the layer is built, so every
    // request in this suite points at the throwaway database.
    process.env.DATABASE_URL = testDatabaseUrl(base)
  }, 120_000)

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl
    }
    await dropTestDatabase(base)
  }, 60_000)

  describe("crawl", () => {
    // Session noise and paging are dropped by `normalizeSearchUrl`, so the two
    // links below are the same saved search.
    const searchUrl = (text: string) =>
      `https://hh.ru/search/vacancy?text=${text}&area=1&search_session_id=${randomUUID()}`

    test("CrawlStart reuses search_query by normalized URL and starts a run", async () => {
      const tenant = await seedTenant("crawl-start")
      const url = searchUrl("typescript")

      const first = await crawlStart(tenant.userId, { url })
      expect(first.status).toBe("running")
      expect(first.nextPage).toBe(0)
      expect(first.pagesDone).toBe(0)
      expect(first.found).toBe(0)
      expect(first.error).toBeNull()
      expect(first.finishedAt).toBeNull()
      expect(first.normalizedUrl).not.toContain("search_session_id")

      // A run resumed at a later page and with a different session id is still
      // the same saved search.
      const second = await crawlStart(tenant.userId, {
        url: `${url.replace("area=1", "area=1&page=2")}`,
        startPage: 2
      })
      expect(second.queryId).toBe(first.queryId)
      expect(second.runId).not.toBe(first.runId)
      expect(second.normalizedUrl).toBe(first.normalizedUrl)
      expect(second.nextPage).toBe(2)

      const query = await findSearchQuery(first.normalizedUrl)
      expect(query?.id).toBe(first.queryId)
      expect(query?.textQuery).toBe("typescript")
      expect(query?.title).toBe("typescript")

      const runs = await searchRunRowsFor(first.queryId)
      expect(runs.map((run) => run.id).sort()).toEqual([first.runId, second.runId].sort())
    })

    test("CrawlSavePage advances the cursor and stores deduped hits", async () => {
      const tenant = await seedTenant("crawl-save")
      const v1 = await seedVacancy("crawl-save-1")
      const v2 = await seedVacancy("crawl-save-2")
      const v3 = await seedVacancy("crawl-save-3")
      const run = await crawlStart(tenant.userId, { url: searchUrl("effect") })

      // The same card twice on one page becomes one hit at the first position.
      const saved = await crawlSavePage(tenant.userId, {
        runId: run.runId,
        nextPage: 1,
        pagesDone: 1,
        found: 25,
        vacancyIds: [v1, v2, v2]
      })
      expect(saved.status).toBe("running")
      expect(saved.nextPage).toBe(1)
      expect(saved.pagesDone).toBe(1)
      expect(saved.found).toBe(25)

      const firstHits = await searchHitsFor(run.queryId)
      expect(firstHits.map((hit) => hit.vacancyId)).toEqual([v1, v2])
      expect(firstHits.map((hit) => hit.position)).toEqual([0, 1])

      // A later page overlaps with the previous one: (query, vacancy) is the
      // primary key, so the repeated card does not duplicate and the stored
      // position is not rewritten.
      const advanced = await crawlSavePage(tenant.userId, {
        runId: run.runId,
        nextPage: 2,
        pagesDone: 2,
        found: 41,
        vacancyIds: [v2, v3]
      })
      expect(advanced.nextPage).toBe(2)
      expect(advanced.pagesDone).toBe(2)
      expect(advanced.found).toBe(41)

      const hits = await searchHitsFor(run.queryId)
      expect(hits.map((hit) => hit.vacancyId).sort()).toEqual([v1, v2, v3].sort())
      expect(hits.find((hit) => hit.vacancyId === v2)?.position).toBe(1)
    })

    test("CrawlFinish stores done/stopped/error with finished_at", async () => {
      const tenant = await seedTenant("crawl-finish")
      const url = searchUrl("postgres")

      const doneRun = await crawlStart(tenant.userId, { url })
      const done = await crawlFinish(tenant.userId, {
        runId: doneRun.runId,
        status: "done",
        nextPage: 3,
        pagesDone: 3,
        found: 60
      })
      expect(done.status).toBe("done")
      expect(done.nextPage).toBe(3)
      expect(done.pagesDone).toBe(3)
      expect(done.found).toBe(60)
      expect(done.error).toBeNull()
      expect(done.finishedAt).not.toBeNull()

      const stoppedRun = await crawlStart(tenant.userId, { url })
      const stopped = await crawlFinish(tenant.userId, {
        runId: stoppedRun.runId,
        status: "stopped",
        nextPage: 2,
        pagesDone: 2,
        found: 40
      })
      expect(stopped.status).toBe("stopped")
      expect(stopped.error).toBeNull()
      expect(stopped.finishedAt).not.toBeNull()

      const errorRun = await crawlStart(tenant.userId, { url })
      const failed = await crawlFinish(tenant.userId, {
        runId: errorRun.runId,
        status: "error",
        nextPage: 1,
        pagesDone: 1,
        found: 20,
        error: "captcha on page 2"
      })
      expect(failed.status).toBe("error")
      expect(failed.error).toBe("captcha on page 2")
      expect(failed.finishedAt).not.toBeNull()

      // `finished_at` and the error text are persisted, not only echoed back.
      const rows = await searchRunRowsFor(doneRun.queryId)
      const storedError = rows.find((row) => row.id === errorRun.runId)
      expect(storedError?.status).toBe("error")
      expect(storedError?.error).toBe("captcha on page 2")
      expect(storedError?.finishedAt).not.toBeNull()
      expect(rows.find((row) => row.id === doneRun.runId)?.finishedAt).not.toBeNull()
    })

    test("CrawlRunsList returns completed runs with counts", async () => {
      const tenant = await seedTenant("crawl-runs-list")
      const url = searchUrl("counts")

      const run = await crawlStart(tenant.userId, { url })
      const finished = await crawlFinish(tenant.userId, {
        runId: run.runId,
        status: "done",
        nextPage: 3,
        pagesDone: 3,
        found: 60,
        inserted: 40,
        updated: 10,
        skipped: 10
      })
      expect(finished.inserted).toBe(40)
      expect(finished.updated).toBe(10)
      expect(finished.skipped).toBe(10)

      const listed = await crawlRunsList(tenant.userId, { url })
      expect(listed.total).toBeGreaterThanOrEqual(1)
      const item = listed.items.find((r) => r.runId === run.runId)
      expect(item).toBeDefined()
      expect(item?.inserted).toBe(40)
      expect(item?.updated).toBe(10)
      expect(item?.skipped).toBe(10)

      const byQuery = await crawlRunsList(tenant.userId, { queryId: run.queryId })
      expect(byQuery.items.some((r) => r.runId === run.runId)).toBe(true)
    })

    test("a second run of the same URL reuses the query and keeps its own cursor", async () => {
      const tenant = await seedTenant("crawl-resume")
      const url = searchUrl("remote")
      const vacancyId = await seedVacancy("crawl-resume")

      const first = await crawlStart(tenant.userId, { url })
      await crawlSavePage(tenant.userId, {
        runId: first.runId,
        nextPage: 1,
        pagesDone: 1,
        found: 20,
        vacancyIds: [vacancyId]
      })
      const finished = await crawlFinish(tenant.userId, {
        runId: first.runId,
        status: "done",
        nextPage: 1,
        pagesDone: 1,
        found: 20
      })
      expect(finished.status).toBe("done")

      // Same search, new attempt: the saved query is reused, the run is new.
      const second = await crawlStart(tenant.userId, {
        url: `${url}&page=1`,
        startPage: 1
      })
      expect(second.queryId).toBe(first.queryId)
      expect(second.runId).not.toBe(first.runId)
      expect(second.status).toBe("running")
      expect(second.pagesDone).toBe(0)
      expect(second.found).toBe(0)
      expect(second.finishedAt).toBeNull()

      const runs = await searchRunRowsFor(first.queryId)
      expect(runs).toHaveLength(2)
      expect(runs.map((run) => run.id).sort()).toEqual([first.runId, second.runId].sort())
      expect(runs.find((run) => run.id === first.runId)?.status).toBe("done")
      expect(runs.find((run) => run.id === second.runId)?.status).toBe("running")

      // Hits belong to the query, so a second run rediscovering the same card
      // does not duplicate it.
      await crawlSavePage(tenant.userId, {
        runId: second.runId,
        nextPage: 2,
        pagesDone: 1,
        found: 10,
        vacancyIds: [vacancyId]
      })
      expect(await searchHitsFor(first.queryId)).toHaveLength(1)

      // The finished run stays finished; status is the run, not the query.
      expect((await crawlStatus(tenant.userId, first.runId)).status).toBe("done")
      expect((await crawlStatus(tenant.userId, second.runId)).status).toBe("running")
    })

    test("an unknown run is NotFound instead of a silent write", async () => {
      const tenant = await seedTenant("crawl-missing")
      const unknown = randomUUID()

      const error = await crawlSavePageFailure(tenant.userId, {
        runId: unknown,
        nextPage: 1,
        pagesDone: 1,
        found: 1,
        vacancyIds: []
      })
      expect(error._tag).toBe("NotFound")
    })
  })
}
