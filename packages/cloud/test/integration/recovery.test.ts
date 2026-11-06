import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../src/db/Database.ts"
import { schedule, scheduleRun, searchRun } from "../../src/db/tables.ts"
import { recoverInterruptedRuns } from "../../src/services/recovery.ts"
import * as ScheduleRunRepository from "../../src/repositories/ScheduleRunRepository.ts"
import * as support from "./support/index.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

if (!enabled || serverUrl === null) {
  test("recovery integration suite is opt-in", () => {
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

  const ownerSql = (statement: ReturnType<typeof sql>) =>
    support.runAs(
      "owner",
      Effect.gen(function*() {
        const database = yield* Database
        yield* database.asOwner((tx) => tx.execute(statement))
      })
    )

  describe("interrupted runs", () => {
    test("stale running rows are marked interrupted and fresh rows are untouched", async () => {
      const staleScheduleId = randomUUID()
      const freshScheduleId = randomUUID()
      const staleScheduleRunId = randomUUID()
      const freshScheduleRunId = randomUUID()
      const searchQueryId = randomUUID()
      const staleSearchRunId = randomUUID()
      const freshSearchRunId = randomUUID()

      await ownerSql(sql`
        insert into schedule (id, user_id, kind, target_id, interval_minutes, enabled, next_run_at)
        values
          (${staleScheduleId}, null, 'vacancy_hydration', 'global', 30, true, now()),
          (${freshScheduleId}, null, 'vacancy_hydration', 'global', 30, true, now())
      `)
      await ownerSql(sql`
        insert into schedule_run (id, schedule_id, kind, status, started_at)
        values
          (${staleScheduleRunId}, ${staleScheduleId}, 'vacancy_hydration', 'running', now() - interval '2 hours'),
          (${freshScheduleRunId}, ${freshScheduleId}, 'vacancy_hydration', 'running', now() - interval '2 minutes')
      `)
      await ownerSql(sql`
        insert into search_query (id, url, normalized_url, title)
        values (${searchQueryId}, 'https://hh.ru/search/vacancy?text=recovery', 'https://hh.ru/search/vacancy?text=recovery', 'recovery')
      `)
      await ownerSql(sql`
        insert into search_run (id, query_id, status, next_page, started_at)
        values
          (${staleSearchRunId}, ${searchQueryId}, 'running', 0, now() - interval '2 hours'),
          (${freshSearchRunId}, ${searchQueryId}, 'running', 0, now() - interval '2 minutes')
      `)

      const recovered = await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asOwner((tx) => recoverInterruptedRuns(tx))
        })
      )

      expect(recovered).toEqual({ scheduleRuns: 1, searchRuns: 1 })

      const rows = await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asOwner((tx) =>
            Effect.all([
              tx.select().from(scheduleRun).where(eq(scheduleRun.id, staleScheduleRunId)),
              tx.select().from(scheduleRun).where(eq(scheduleRun.id, freshScheduleRunId)),
              tx.select().from(searchRun).where(eq(searchRun.id, staleSearchRunId)),
              tx.select().from(searchRun).where(eq(searchRun.id, freshSearchRunId))
            ])
          )
        })
      )
      const [staleScheduleRun, freshScheduleRun, staleSearchRun, freshSearchRun] = rows

      expect(staleScheduleRun?.[0]?.status).toBe("error")
      expect(staleScheduleRun?.[0]?.error).toContain("interrupted")
      expect(staleScheduleRun?.[0]?.finishedAt).toBeInstanceOf(Date)
      expect(staleScheduleRun?.[0]?.detail).toMatchObject({ interrupted: true })

      expect(staleSearchRun?.[0]?.status).toBe("stopped")
      expect(staleSearchRun?.[0]?.error).toContain("interrupted")
      expect(staleSearchRun?.[0]?.finishedAt).toBeInstanceOf(Date)

      expect(freshScheduleRun?.[0]?.status).toBe("running")
      expect(freshScheduleRun?.[0]?.finishedAt).toBeNull()
      expect(freshScheduleRun?.[0]?.error).toBeNull()
      expect(freshSearchRun?.[0]?.status).toBe("running")
      expect(freshSearchRun?.[0]?.finishedAt).toBeNull()
    })

    test("a run is alive by its heartbeat, not by its start time", async () => {
      const scheduleId = randomUUID()
      const beatingId = randomUUID()
      const silentId = randomUUID()
      await ownerSql(sql`
        insert into schedule (id, user_id, kind, target_id, interval_minutes, enabled, next_run_at)
        values (${scheduleId}, null, 'analysis', 'global', 10, true, now())
      `)
      await ownerSql(sql`
        insert into schedule_run (id, schedule_id, kind, status, started_at, heartbeat_at)
        values
          (${beatingId}, ${scheduleId}, 'analysis', 'running', now() - interval '1 hour', now() - interval '10 seconds'),
          (${silentId}, ${scheduleId}, 'analysis', 'running', now() - interval '1 hour', now() - interval '10 minutes')
      `)

      const live = await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asOwner((tx) => ScheduleRunRepository.hasLiveRun(tx, "analysis"))
        })
      )
      expect(live).toBe(true)

      await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asOwner((tx) => recoverInterruptedRuns(tx))
        })
      )
      const rows = await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asOwner((tx) =>
            Effect.all([
              tx.select().from(scheduleRun).where(eq(scheduleRun.id, beatingId)),
              tx.select().from(scheduleRun).where(eq(scheduleRun.id, silentId))
            ])
          )
        })
      )
      expect(rows[0]?.[0]?.status).toBe("running")
      expect(rows[1]?.[0]?.status).toBe("error")

      // Once the beating run ends, nothing blocks the next one.
      await ownerSql(sql`update schedule_run set status = 'done' where id = ${beatingId}`)
      const after = await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asOwner((tx) => ScheduleRunRepository.hasLiveRun(tx, "analysis"))
        })
      )
      expect(after).toBe(false)
    })

    test("an interrupted pass pulls its schedule forward once, not in a loop", async () => {
      const fresh = randomUUID()
      const looping = randomUUID()
      await ownerSql(sql`
        insert into schedule (id, user_id, kind, target_id, interval_minutes, enabled, next_run_at)
        values
          (${fresh}, null, 'analysis', 'retry-a', 10, true, now() + interval '8 minutes'),
          (${looping}, null, 'analysis', 'retry-b', 10, true, now() + interval '8 minutes')
      `)
      await ownerSql(sql`
        insert into schedule_run (id, schedule_id, kind, status, started_at, heartbeat_at, finished_at, detail)
        values
          (${randomUUID()}, ${fresh}, 'analysis', 'done', now() - interval '30 minutes', now() - interval '30 minutes', now() - interval '25 minutes', '{}'::jsonb),
          (${randomUUID()}, ${looping}, 'analysis', 'error', now() - interval '30 minutes', now() - interval '30 minutes', now() - interval '25 minutes', '{"interrupted": true}'::jsonb)
      `)
      await ownerSql(sql`
        insert into schedule_run (id, schedule_id, kind, status, started_at, heartbeat_at)
        values
          (${randomUUID()}, ${fresh}, 'analysis', 'running', now() - interval '20 minutes', now() - interval '10 minutes'),
          (${randomUUID()}, ${looping}, 'analysis', 'running', now() - interval '20 minutes', now() - interval '10 minutes')
      `)

      await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asOwner((tx) => recoverInterruptedRuns(tx))
        })
      )
      const rows = await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asOwner((tx) =>
            Effect.all([
              tx.select().from(schedule).where(eq(schedule.id, fresh)),
              tx.select().from(schedule).where(eq(schedule.id, looping))
            ])
          )
        })
      )
      expect(rows[0]?.[0]?.nextRunAt?.getTime()).toBeLessThanOrEqual(Date.now())
      expect(rows[1]?.[0]?.nextRunAt?.getTime()).toBeGreaterThan(Date.now())
    })
  })
}
