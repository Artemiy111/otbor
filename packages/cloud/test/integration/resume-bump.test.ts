/**
 * Подъём резюме против настоящего Postgres: расписание ставит задачи по одной на
 * резюме, харнесс присылает свидетельство, облако решает исход и держит отдых
 * в 4 часа. hh.ru не нужен: харнесс изображён вызовами completeJob.
 */
import type { HarnessExit } from "@otbor/contract"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../src/db/Database.ts"
import { enqueueResumeBumps } from "../../src/services/ResumeBump.ts"
import * as support from "./support/index.ts"

const { integrationEnabled, serverUrl } = support

const clickedExit = (before: string | null, after: string | null): HarnessExit => ({
  tag: "submitted",
  message: "resume bumped",
  artifacts: {
    clicked: true,
    label: "Поднять в поиске",
    lastBumpBefore: before,
    lastBumpAfter: after,
    url: "https://hh.ru/resume/x"
  }
})

if (!integrationEnabled || serverUrl === null) {
  test("resume-bump integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    expect(integrationEnabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  describe("resume bump", () => {
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

    const enqueue = (userId: string) =>
      support.runAs(
        userId,
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asUser(userId, (tx) => enqueueResumeBumps(tx, userId, { jitterMinutes: 0 }))
        })
      )

    const resumeRow = (resumeId: string) =>
      support.runAs(
        "owner",
        support.ownerTx((tx) =>
          tx
            .execute(
              sql`select last_bumped_at, last_bump_attempt_at, last_bump_outcome, last_bump_text, last_bump_note from resume where id = ${resumeId}::uuid`
            )
            .pipe(Effect.map((result) => result.rows[0] as Record<string, any>))
        )
      )

    const setResume = (resumeId: string, fragment: ReturnType<typeof sql>) =>
      support.runAs(
        "owner",
        support.ownerTx((tx) => tx.execute(sql`update resume set ${fragment} where id = ${resumeId}::uuid`))
      )

    const setup = async (label: string) => {
      const tenant = await support.seedTenant(label)
      const resumeId = await support.seedResume({
        userId: tenant.userId,
        accountId: tenant.accountId,
        title: "Backend"
      })
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      const finish = async (exit: HarnessExit) => {
        const leased = await support.leaseNext(tenant.userId, harness.id, harness.token!, [tenant.accountId])
        expect(leased.job?.stage).toBe("resume_bump")
        expect((leased.job!.payload as { resumeId?: string }).resumeId).toBe(resumeId)
        await support.completeJob(tenant.userId, {
          harnessId: harness.id,
          token: harness.token!,
          jobId: leased.job!.id,
          leaseId: leased.job!.leaseId!,
          epoch: leased.job!.leaseEpoch,
          exit
        })
        return leased.job!
      }
      return { tenant, resumeId, finish }
    }

    test("одна задача на резюме; пока она ждёт, вторая не ставится", async () => {
      const ctx = await setup("bump-enqueue")
      expect(await enqueue(ctx.tenant.userId)).toEqual({ queued: 1, candidates: 1 })
      expect((await enqueue(ctx.tenant.userId)).queued).toBe(0)
    })

    test("подтверждённый подъём записывается, а отдых в 4 часа не даёт поставить задачу снова", async () => {
      const ctx = await setup("bump-done")
      await enqueue(ctx.tenant.userId)
      await ctx.finish(clickedExit("08 ноября в 19:15", "09 ноября в 23:40"))

      const row = await resumeRow(ctx.resumeId)
      expect(row.last_bump_outcome).toBe("bumped")
      expect(row.last_bump_text).toBe("09 ноября в 23:40")
      expect(row.last_bumped_at).not.toBeNull()
      expect((await enqueue(ctx.tenant.userId)).queued).toBe(0)

      // Через 5 часов резюме снова пора поднимать.
      await setResume(
        ctx.resumeId,
        sql`last_bumped_at = now() - interval '5 hours', last_bump_attempt_at = now() - interval '5 hours'`
      )
      expect((await enqueue(ctx.tenant.userId)).queued).toBe(1)
    })

    test("нажатие без изменения карточки не считается подъёмом, но отдых заводит", async () => {
      const ctx = await setup("bump-unconfirmed")
      await enqueue(ctx.tenant.userId)
      await ctx.finish(clickedExit("08 ноября в 19:15", "08 ноября в 19:15"))
      const row = await resumeRow(ctx.resumeId)
      expect(row.last_bump_outcome).toBe("unconfirmed")
      expect(row.last_bumped_at).not.toBeNull()
      expect((await enqueue(ctx.tenant.userId)).queued).toBe(0)
    })

    test("недоступная кнопка - обычный исход: задача done, отдых не заводится", async () => {
      const ctx = await setup("bump-unavailable")
      await enqueue(ctx.tenant.userId)
      const job = await ctx.finish({
        tag: "blocked",
        message: "bump not available: Поднимать автоматически",
        artifacts: {
          clicked: false,
          label: "Поднимать автоматически",
          lastBumpBefore: "08 ноября в 19:15",
          lastBumpAfter: "08 ноября в 19:15",
          url: "https://hh.ru/resume/x"
        }
      })
      const row = await resumeRow(ctx.resumeId)
      expect(row.last_bump_outcome).toBe("unavailable")
      expect(row.last_bump_note).toBe("Поднимать автоматически")
      expect(row.last_bumped_at).toBeNull()
      const jobs = await support.runAs(
        "owner",
        support.ownerTx((tx) =>
          tx
            .execute(sql`select status from harness_jobs where id = ${job.id}::uuid`)
            .pipe(Effect.map((result) => result.rows as ReadonlyArray<Record<string, any>>))
        )
      )
      expect(jobs[0]!.status).toBe("done")
    })

    test("харнесс заявил submitted без свидетельства о нажатии: подъёма нет", async () => {
      const ctx = await setup("bump-liar")
      await enqueue(ctx.tenant.userId)
      await ctx.finish({
        tag: "submitted",
        message: "resume bumped",
        artifacts: {
          clicked: false,
          label: null,
          lastBumpBefore: null,
          lastBumpAfter: null,
          url: "https://hh.ru/resume/x"
        }
      })
      expect((await resumeRow(ctx.resumeId)).last_bump_outcome).toBeNull()
    })

    test("заблокированное и черновое резюме пропускаются", async () => {
      const ctx = await setup("bump-blocked")
      await setResume(ctx.resumeId, sql`status = 'blocked'`)
      expect(await enqueue(ctx.tenant.userId)).toEqual({ queued: 0, candidates: 0 })
    })
  })
}
