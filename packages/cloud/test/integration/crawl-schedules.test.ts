/** Integration: crawl-schedules. See README.md for how to run. */
import { InvalidInput } from "@otbor/contract"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { randomUUID } from "node:crypto"
import { CrawlRunner, type CrawlRunnerResult } from "../../src/services/CrawlRunner.ts"
import { ScheduleService } from "../../src/services/ScheduleService.ts"
import {
  createTestDatabase,
  dropTestDatabase,
  findScheduleRow,
  integrationEnabled,
  migrateTestDatabase,
  recordingRunner,
  runAsWithRunner,
  runDueSchedulesAs,
  scheduleRemove,
  scheduleRowsFor,
  scheduleRunNowFailure,
  scheduleUpsert,
  scheduleUpsertFailure,
  schedulesList,
  seedTenant,
  serverUrl,
  setScheduleNextRun,
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

  describe("crawl schedules", () => {
    const searchUrl = (text: string) => `https://hh.ru/search/vacancy?text=${text}&area=1`

    const cleanResult = (): CrawlRunnerResult => ({
      runId: randomUUID(),
      status: "done",
      reason: "last_page",
      error: null,
      pagesDone: 1,
      found: 2,
      inserted: 2,
      updated: 0,
      skipped: 0,
      errors: 0
    })

    test("upsert, list, update and remove are user-scoped", async () => {
      const a = await seedTenant("sched-a")
      const b = await seedTenant("sched-b")

      const created = await scheduleUpsert(a.userId, {
        targetId: searchUrl("typescript"),
        intervalMinutes: 60,
        enabled: true
      })
      expect(created.kind).toBe("search")
      expect(created.targetId).toBe(searchUrl("typescript"))
      expect(created.intervalMinutes).toBe(60)
      expect(created.enabled).toBe(true)
      expect(created.nextRunAt).not.toBeNull()
      expect(created.lastRunAt).toBeNull()
      expect(created.lastError).toBeNull()

      expect((await schedulesList(a.userId)).map((row) => row.id)).toEqual([created.id])
      expect(await schedulesList(b.userId)).toEqual([])

      const updated = await scheduleUpsert(a.userId, {
        id: created.id,
        targetId: searchUrl("effect"),
        intervalMinutes: 15,
        enabled: false
      })
      expect(updated.id).toBe(created.id)
      expect(updated.targetId).toBe(searchUrl("effect"))
      expect(updated.intervalMinutes).toBe(15)
      expect(updated.enabled).toBe(false)
      expect(updated.nextRunAt).toBeNull()

      // B cannot see or delete A's row.
      expect(await scheduleRemove(b.userId, created.id)).toMatchObject({ deleted: false })
      expect(await schedulesList(a.userId)).toHaveLength(1)
      expect(await scheduleRemove(a.userId, created.id)).toMatchObject({
        id: created.id,
        deleted: true
      })
      expect(await schedulesList(a.userId)).toEqual([])

      // runNow on a missing row is NotFound, not a silent accepted.
      const missing = await scheduleRunNowFailure(a.userId, randomUUID())
      expect(missing._tag).toBe("NotFound")
    })

    test("a bad interval or target is rejected before it reaches the table", async () => {
      const tenant = await seedTenant("sched-invalid")

      const badInterval = await scheduleUpsertFailure(tenant.userId, {
        targetId: searchUrl("devops"),
        intervalMinutes: 0
      })
      expect(badInterval._tag).toBe("InvalidInput")

      const badTarget = await scheduleUpsertFailure(tenant.userId, {
        targetId: "not a url",
        intervalMinutes: 30
      })
      expect(badTarget._tag).toBe("InvalidInput")
      expect(await scheduleRowsFor(tenant.userId)).toEqual([])
    })

    test("the worker claims only due searches and advances next_run_at", async () => {
      const tenant = await seedTenant("sched-due")
      const now = new Date("2026-11-02T12:00:00.000Z")

      const due = await scheduleUpsert(tenant.userId, {
        targetId: searchUrl("due"),
        intervalMinutes: 30
      })
      const future = await scheduleUpsert(tenant.userId, {
        targetId: searchUrl("future"),
        intervalMinutes: 60
      })
      const disabled = await scheduleUpsert(tenant.userId, {
        targetId: searchUrl("disabled"),
        intervalMinutes: 10,
        enabled: false
      })

      await setScheduleNextRun(due.id, new Date(now.getTime() - 60_000))
      await setScheduleNextRun(future.id, new Date(now.getTime() + 60_000))

      const targets: Array<string> = []
      const outcomes = await runDueSchedulesAs(tenant.userId, recordingRunner(targets), {
        now,
        limit: 10
      })

      expect(targets).toEqual([due.targetId])
      expect(outcomes).toHaveLength(1)
      expect(outcomes[0]).toMatchObject({ scheduleId: due.id, ok: true, error: null })

      const claimed = (await findScheduleRow(due.id))!
      expect(claimed.lastRunAt?.toISOString()).toBe(now.toISOString())
      expect(claimed.nextRunAt?.toISOString()).toBe(
        new Date(now.getTime() + 30 * 60_000).toISOString()
      )

      const untouched = (await findScheduleRow(future.id))!
      expect(untouched.lastRunAt).toBeNull()
      expect(untouched.nextRunAt?.toISOString()).toBe(
        new Date(now.getTime() + 60_000).toISOString()
      )
      const stillDisabled = (await findScheduleRow(disabled.id))!
      expect(stillDisabled.lastRunAt).toBeNull()
      expect(stillDisabled.nextRunAt).toBeNull()

      for (const row of [due, future, disabled]) {
        await scheduleRemove(tenant.userId, row.id)
      }
    })

    test("a failing schedule records last_error and does not stop the next one", async () => {
      const tenant = await seedTenant("sched-failure")
      const now = new Date("2026-11-02T13:00:00.000Z")

      const bad = await scheduleUpsert(tenant.userId, {
        targetId: searchUrl("blocked"),
        intervalMinutes: 30
      })
      const good = await scheduleUpsert(tenant.userId, {
        targetId: searchUrl("healthy"),
        intervalMinutes: 30
      })
      await setScheduleNextRun(bad.id, new Date(now.getTime() - 120_000))
      await setScheduleNextRun(good.id, new Date(now.getTime() - 60_000))

      const targets: Array<string> = []
      const runner = Layer.succeed(CrawlRunner, CrawlRunner.of({
        run: (input) => {
          targets.push(input.url)
          return input.url === bad.targetId
            ? Effect.fail(new InvalidInput({ message: "hh is blocked" }))
            : Effect.succeed(cleanResult())
        }
      }))

      const outcomes = await runDueSchedulesAs(tenant.userId, runner, { now, limit: 10 })

      expect(targets.sort()).toEqual([bad.targetId, good.targetId].sort())
      expect(outcomes).toHaveLength(2)
      expect(outcomes.find((row) => row.scheduleId === bad.id)).toMatchObject({
        ok: false,
        error: "hh is blocked"
      })
      expect(outcomes.find((row) => row.scheduleId === good.id)).toMatchObject({ ok: true })

      expect((await findScheduleRow(bad.id))?.lastError).toBe("hh is blocked")
      expect((await findScheduleRow(bad.id))?.lastRunAt).not.toBeNull()
      expect((await findScheduleRow(good.id))?.lastError).toBeNull()
      expect((await findScheduleRow(good.id))?.lastRunAt).not.toBeNull()

      await scheduleRemove(tenant.userId, bad.id)
      await scheduleRemove(tenant.userId, good.id)
    })

    test("run now accepts immediately and moves the next run forward", async () => {
      const tenant = await seedTenant("sched-run-now")
      const created = await scheduleUpsert(tenant.userId, {
        targetId: searchUrl("manual"),
        intervalMinutes: 45
      })

      const called = Deferred.makeUnsafe<void>()
      const targets: Array<string> = []
      const runner = Layer.succeed(CrawlRunner, CrawlRunner.of({
        run: (input) =>
          Effect.gen(function*() {
            targets.push(input.url)
            yield* Deferred.succeed(called, undefined)
            return cleanResult()
          })
      }))

      const accepted = await runAsWithRunner(
        tenant.userId,
        runner,
        Effect.gen(function*() {
          const schedules = yield* ScheduleService
          const result = yield* schedules.runNow(created.id)
          // Wait for the detached fiber to start, not for the crawl to end.
          yield* Deferred.await(called).pipe(Effect.timeout("2 seconds"))
          return result
        })
      )

      expect(accepted.accepted).toBe(true)
      expect(accepted.schedule.id).toBe(created.id)
      expect(accepted.schedule.lastRunAt).not.toBeNull()
      expect(accepted.schedule.nextRunAt).not.toBeNull()

      const lastRunAt = new Date(accepted.schedule.lastRunAt!).getTime()
      const nextRunAt = new Date(accepted.schedule.nextRunAt!).getTime()
      expect(nextRunAt - lastRunAt).toBe(45 * 60_000)
      expect(targets).toEqual([created.targetId])

      await scheduleRemove(tenant.userId, created.id)
    })
  })
}
