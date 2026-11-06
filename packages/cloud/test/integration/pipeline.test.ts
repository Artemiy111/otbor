import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { VacancyId } from "@otbor/contract"
import { eq, sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { decision } from "../../src/db/tables.ts"
import { Database } from "../../src/db/Database.ts"
import { CrawlRunner, type CrawlRunnerResult } from "../../src/services/CrawlRunner.ts"
import { DecisionService } from "../../src/services/DecisionService.ts"
import { runDueSchedules } from "../../src/services/ScheduleWorker.ts"
import { DEFAULT_SEARCH_CRAWL_PAGES } from "../../src/services/ScheduleDispatcher.ts"
import { ScheduleService } from "../../src/services/ScheduleService.ts"
import * as support from "./support/index.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

const ids = (rows: ReadonlyArray<{ readonly vacancyId: string }>) => rows.map((row) => row.vacancyId)

if (!enabled || serverUrl === null) {
  test("pipeline integration suite is opt-in", () => {
    expect(enabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  beforeAll(async () => {
    await support.createTestDatabase(base)
    await support.migrateTestDatabase(base)
    process.env.DATABASE_URL = support.testDatabaseUrl(base)
  }, 120_000)

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    await support.dropTestDatabase(base)
  }, 60_000)

  /** Vacancies are shared corpus, so every test scopes its batch by id. */
  const evaluateIds = (userId: string, vacancyIds: ReadonlyArray<string>, extra: Record<string, unknown> = {}) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        const decisions = yield* DecisionService
        return yield* decisions.evaluateBatch({
          vacancyIds: vacancyIds as ReadonlyArray<VacancyId>,
          ...extra
        })
      })
    )

  const listDecisions = (userId: string, options: Record<string, unknown> = {}) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        const decisions = yield* DecisionService
        return yield* decisions.list(options)
      })
    )

  const decisionRows = (vacancyId: string) =>
    support.runAs(
      "owner",
      Effect.gen(function*() {
        const database = yield* Database
        return yield* database.asOwner((tx) =>
          tx.select().from(decision).where(eq(decision.vacancyId, vacancyId)).orderBy(decision.createdAt)
        )
      })
    )

  const ownerSql = (statement: ReturnType<typeof sql>) =>
    support.runAs(
      "owner",
      Effect.gen(function*() {
        const database = yield* Database
        yield* database.asOwner((tx) => tx.execute(statement))
      })
    )

  const setContentHash = (vacancyId: string, hash: string) =>
    ownerSql(sql`update vacancy set content_hash = ${hash} where id = ${vacancyId}`)

  const devops = (label: string, salaryFrom: number, workFormats: ReadonlyArray<string>) =>
    support.seedVacancyTitled(label, `DevOps engineer ${label}`, {
      salaryFrom,
      workFormats,
      descriptionText: "Kubernetes Terraform Linux"
    })

  describe("batch evaluation", () => {
    test("decides vacancies without a decision once, then reports nothing left", async () => {
      const tenant = await support.seedTenant("batch-basic")
      const suffix = randomUUID().slice(0, 6)
      const a = await devops(`a-${suffix}`, 400_000, ["remote"])
      const b = await support.seedVacancyTitled(`b-${suffix}`, `Frontend developer ${suffix}`)
      const c = await support.seedVacancyTitled(`c-${suffix}`, `DevOps archived ${suffix}`, { archived: true })

      const first = await evaluateIds(tenant.userId, [a, b, c])
      expect(first.evaluated).toBe(3)
      expect(first.apply + first.draft + first.skip).toBe(3)
      expect(first.remaining).toBe(0)
      expect(Object.values(first.byReason).reduce((sum, n) => sum + n, 0)).toBe(3)
      // The archived and the Frontend vacancy both fail the apply filter.
      expect(first.byReason.blocked_filter).toBe(2)

      const again = await evaluateIds(tenant.userId, [a, b, c])
      expect(again).toMatchObject({ evaluated: 0, remaining: 0 })
      for (const id of [a, b, c]) expect(await decisionRows(id)).toHaveLength(1)
    })

    test("limit bounds a batch and reports what is left", async () => {
      const tenant = await support.seedTenant("batch-limit")
      const suffix = randomUUID().slice(0, 6)
      const all = await Promise.all(
        [1, 2, 3, 4, 5].map((n) => support.seedVacancyTitled(`l${n}-${suffix}`, `Manager ${n} ${suffix}`))
      )

      const first = await evaluateIds(tenant.userId, all, { limit: 2 })
      expect(first).toMatchObject({ evaluated: 2, remaining: 3 })
      const second = await evaluateIds(tenant.userId, all, { limit: 10 })
      expect(second).toMatchObject({ evaluated: 3, remaining: 0 })
    })

    test("changed content, a missing content hash and force make a decision stale", async () => {
      const tenant = await support.seedTenant("batch-stale")
      const suffix = randomUUID().slice(0, 6)
      const v = await devops(`s-${suffix}`, 350_000, ["remote"])

      expect((await evaluateIds(tenant.userId, [v])).evaluated).toBe(1)
      expect((await evaluateIds(tenant.userId, [v])).evaluated).toBe(0)

      // New crawl card / hydration changes content_hash: a new decision row.
      await setContentHash(v, `changed-${suffix}`)
      expect((await evaluateIds(tenant.userId, [v])).evaluated).toBe(1)
      expect(await decisionRows(v)).toHaveLength(2)
      expect((await evaluateIds(tenant.userId, [v])).evaluated).toBe(0)

      // A decision from before the column existed is refreshed in place.
      await ownerSql(sql`update decision set vacancy_content_hash = null where vacancy_id = ${v}`)
      expect((await evaluateIds(tenant.userId, [v])).evaluated).toBe(1)
      expect((await decisionRows(v)).length).toBe(2)
      expect((await evaluateIds(tenant.userId, [v])).evaluated).toBe(0)

      // An old policy version is stale too.
      await ownerSql(sql`update decision set policy_version = 0 where vacancy_id = ${v}`)
      expect((await evaluateIds(tenant.userId, [v])).evaluated).toBe(1)
      expect((await evaluateIds(tenant.userId, [v])).evaluated).toBe(0)

      const forced = await evaluateIds(tenant.userId, [v], { force: true })
      expect(forced.evaluated).toBe(1)
    })

    test("content that flips A -> B -> A ends with the A decision as the latest", async () => {
      const tenant = await support.seedTenant("batch-flip")
      const suffix = randomUUID().slice(0, 6)
      const v = await devops(`f-${suffix}`, 350_000, ["remote"])
      const hashA = `a-${suffix}`
      const hashB = `b-${suffix}`

      await setContentHash(v, hashA)
      await evaluateIds(tenant.userId, [v])
      await setContentHash(v, hashB)
      await evaluateIds(tenant.userId, [v])
      await setContentHash(v, hashA)
      expect((await evaluateIds(tenant.userId, [v])).evaluated).toBe(1)
      // The same inputs reuse the A row; it is re-stamped, so nothing is stale now.
      expect(await decisionRows(v)).toHaveLength(2)
      expect((await evaluateIds(tenant.userId, [v])).evaluated).toBe(0)
    })

    test("decisions are per user: B's batch does not see A's decisions", async () => {
      const a = await support.seedTenant("batch-rls-a")
      const b = await support.seedTenant("batch-rls-b")
      const suffix = randomUUID().slice(0, 6)
      const v = await devops(`r-${suffix}`, 350_000, ["remote"])

      expect((await evaluateIds(a.userId, [v])).evaluated).toBe(1)
      expect(await listDecisions(b.userId, { limit: 200 })).toEqual([])
      expect((await evaluateIds(b.userId, [v])).evaluated).toBe(1)
      expect(ids(await listDecisions(b.userId, { limit: 200 }))).toEqual([v])
    })
  })

  describe("decision ranking", () => {
    test("orderBy priority, minFit, latestPerVacancy and presetId run server-side", async () => {
      const tenant = await support.seedTenant("rank")
      const suffix = randomUUID().slice(0, 6)
      const strong = await devops(`strong-${suffix}`, 500_000, ["remote"])
      const weak = await devops(`weak-${suffix}`, 100_000, ["office"])
      const other = await support.seedVacancyTitled(`other-${suffix}`, `Cook ${suffix}`)
      const all = [strong, weak, other]
      await evaluateIds(tenant.userId, all)

      const byPriority = await listDecisions(tenant.userId, { orderBy: "priority", limit: 10 })
      const priorities = byPriority.map((row) => row.priority)
      expect(priorities).toEqual([...priorities].sort((x, y) => y - x))
      expect(String(byPriority[0]?.vacancyId)).toBe(strong)

      const newest = await listDecisions(tenant.userId, { limit: 10 })
      const stamps = newest.map((row) => row.createdAt)
      expect(stamps).toEqual([...stamps].sort().reverse())

      const topFit = byPriority[0]!.fit
      const fitOnly = await listDecisions(tenant.userId, { minFit: topFit, limit: 10 })
      expect(fitOnly.every((row) => row.fit >= topFit)).toBe(true)
      expect(ids(fitOnly)).toContain(strong)

      // A second decision for the same vacancy: history keeps both, latest keeps one.
      await setContentHash(strong, `rev-${suffix}`)
      await evaluateIds(tenant.userId, [strong])
      const history = await listDecisions(tenant.userId, { limit: 50 })
      expect(ids(history).filter((id) => id === strong)).toHaveLength(2)
      const latest = await listDecisions(tenant.userId, { limit: 50, latestPerVacancy: true })
      expect(ids(latest).filter((id) => id === strong)).toHaveLength(1)
      expect(new Set(ids(latest)).size).toBe(ids(latest).length)

      // latestPerVacancy applies the verdict filter to the survivor only.
      const newestStrong = latest.find((row) => row.vacancyId === strong)!
      const sameVerdict = await listDecisions(tenant.userId, {
        verdict: newestStrong.verdict,
        latestPerVacancy: true,
        limit: 50
      })
      expect(ids(sameVerdict)).toContain(strong)

      const presetId = await support.seedPreset(tenant.userId, {
        title: "devops only",
        filter: { text: `DevOps engineer weak-${suffix}` }
      })
      const inPreset = await listDecisions(tenant.userId, { presetId, limit: 50 })
      expect(new Set(ids(inPreset))).toEqual(new Set([weak]))

      const missing = await support.runAsFailure(
        tenant.userId,
        Effect.gen(function*() {
          const decisions = yield* DecisionService
          return yield* decisions.list({ presetId: randomUUID() })
        })
      )
      expect((missing as { _tag: string })._tag).toBe("NotFound")
    })
  })

  describe("automatic chaining", () => {
    const searchUrl = (text: string) => `https://hh.ru/search/vacancy?text=${text}`

    const crawlResult = (vacancyIds: ReadonlyArray<string>): CrawlRunnerResult => ({
      runId: randomUUID(),
      status: "done",
      reason: "last_page",
      error: null,
      pagesDone: 1,
      found: vacancyIds.length,
      inserted: vacancyIds.length,
      updated: 0,
      skipped: 0,
      errors: 0,
      vacancyIds
    })

    const runnerReturning = (result: CrawlRunnerResult, seen: Array<unknown> = []) =>
      Layer.succeed(CrawlRunner, CrawlRunner.of({
        run: (input) => Effect.sync(() => (seen.push(input), result))
      }))

    const runOnce = (userId: string, runner: ReturnType<typeof runnerReturning>) =>
      support.runAsWithRunner(
        userId,
        runner,
        Effect.gen(function*() {
          const outcomes = yield* runDueSchedules({ now: new Date(Date.now() + 3_600_000) })
          const schedules = yield* ScheduleService
          const runs = yield* schedules.runs({ limit: 20 })
          return { outcomes, runs: runs.items }
        })
      )

    test("a crawl tick evaluates the vacancies it saved and records it in the run detail", async () => {
      const tenant = await support.seedTenant("chain-crawl")
      const suffix = randomUUID().slice(0, 6)
      const saved = [
        await devops(`c1-${suffix}`, 400_000, ["remote"]),
        await support.seedVacancyTitled(`c2-${suffix}`, `Accountant ${suffix}`)
      ]
      const seen: Array<unknown> = []
      await support.scheduleUpsert(tenant.userId, {
        targetId: searchUrl(`chain-${suffix}`),
        intervalMinutes: 30,
        options: { maxPages: 3, delayMs: 5 }
      })

      const { outcomes, runs } = await runOnce(tenant.userId, runnerReturning(crawlResult(saved), seen))

      expect(outcomes.find((o) => o.targetId.includes(suffix))?.ok).toBe(true)
      // The schedule's page options reach the single crawl owner.
      expect(seen[0]).toMatchObject({ maxPages: 3, delayMs: 5, stopWhenNoNew: false })
      expect(runs[0]?.detail).toMatchObject({ evaluated: 2 })
      const stored = await listDecisions(tenant.userId, { limit: 50 })
      expect(new Set(ids(stored))).toEqual(new Set(saved))
    })

    test("a search tick walks the whole result set by default", async () => {
      const tenant = await support.seedTenant("chain-full")
      const suffix = randomUUID().slice(0, 6)
      const seen: Array<unknown> = []
      await support.scheduleUpsert(tenant.userId, {
        targetId: searchUrl(`full-${suffix}`),
        intervalMinutes: 30
      })

      await runOnce(tenant.userId, runnerReturning(crawlResult([]), seen))

      expect(seen[0]).toMatchObject({
        maxPages: DEFAULT_SEARCH_CRAWL_PAGES,
        stopWhenNoNew: false
      })
    })

    test("an evaluation failure is recorded but does not fail the crawl", async () => {
      const tenant = await support.seedTenant("chain-fail")
      const suffix = randomUUID().slice(0, 6)
      await support.scheduleUpsert(tenant.userId, {
        targetId: searchUrl(`fail-${suffix}`),
        intervalMinutes: 30
      })

      // A malformed id makes the evaluation query fail.
      const { outcomes, runs } = await runOnce(
        tenant.userId,
        runnerReturning(crawlResult(["not-a-uuid"]))
      )

      expect(outcomes.find((o) => o.targetId.includes(suffix))).toMatchObject({ ok: true, error: null })
      expect(runs[0]).toMatchObject({ status: "done" })
      expect((runs[0]!.detail as { evaluationError?: string }).evaluationError).toBeString()
    })

    test("the evaluate schedule kind sweeps vacancies nothing else evaluated", async () => {
      const tenant = await support.seedTenant("chain-sweep")
      const suffix = randomUUID().slice(0, 6)
      const missed = await devops(`m-${suffix}`, 400_000, ["remote"])
      const created = await support.scheduleUpsert(tenant.userId, {
        kind: "evaluate",
        targetId: "global",
        intervalMinutes: 60,
        options: { limit: 1000 }
      })
      expect(created.kind).toBe("evaluate")

      const { outcomes, runs } = await runOnce(tenant.userId, runnerReturning(crawlResult([])))

      expect(outcomes.find((o) => o.scheduleId === created.id)).toMatchObject({ ok: true, error: null })
      const run = runs.find((r) => r.scheduleId === created.id)!
      expect(run.kind).toBe("evaluate")
      expect((run.detail as { evaluated: number }).evaluated).toBeGreaterThanOrEqual(1)
      expect(ids(await listDecisions(tenant.userId, { limit: 200 }))).toContain(missed)
    })
  })
}

