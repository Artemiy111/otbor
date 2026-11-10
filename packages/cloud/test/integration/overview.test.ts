/** Integration: overview. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { OverviewService } from "../../src/services/OverviewService.ts"
import {
  addAccount,
  createTestDatabase,
  dropTestDatabase,
  enqueueJob,
  integrationEnabled,
  migrateTestDatabase,
  ownerTx,
  runAs,
  seedTenant,
  seedVacancyTitled,
  serverUrl,
  testDatabaseUrl
} from "./support/index.ts"

if (!integrationEnabled || serverUrl === null) {
  test("cloud integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    expect(integrationEnabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  beforeAll(async () => {
    await createTestDatabase(base)
    await migrateTestDatabase(base)
    process.env.DATABASE_URL = testDatabaseUrl(base)
  }, 120_000)

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    await dropTestDatabase(base)
  }, 60_000)

  const overview = (userId: string, days?: number) =>
    runAs(
      userId,
      Effect.gen(function*() {
        const service = yield* OverviewService
        return yield* service.get({ days })
      })
    )

  /** Заявка напрямую в таблицу: тесту нужны точные состояния и времена. */
  const insertApplication = (
    userId: string,
    accountId: string,
    vacancyId: string,
    fields: {
      readonly state: string
      readonly origin?: string
      readonly blockedReason?: string | null
      readonly hhStatus?: string | null
      readonly submittedAgo?: string | null
      readonly retryIn?: string | null
      readonly lastError?: string | null
    }
  ) =>
    runAs(
      userId,
      ownerTx((tx) =>
        tx.execute(sql`
          insert into application (user_id, hh_account_id, vacancy_id, state, origin, blocked_reason,
                                   hh_status, hh_responded_at, submitted_at, retry_at, last_error)
          values (
            ${userId}, ${accountId}, ${vacancyId}, ${fields.state}, ${fields.origin ?? "otbor"},
            ${fields.blockedReason ?? null}, ${fields.hhStatus ?? null},
            ${fields.hhStatus ? sql`now() - interval '1 hour'` : sql`null`},
            ${fields.submittedAgo ? sql`now() - ${fields.submittedAgo}::interval` : sql`null`},
            ${fields.retryIn ? sql`now() + ${fields.retryIn}::interval` : sql`null`},
            ${fields.lastError ?? null}
          )
        `)
      )
    )

  describe("OverviewGet", () => {
    test("counts applications, funnel, accounts, jobs and the timeline for one user", async () => {
      const tenant = await seedTenant("ov-mine")
      const other = await seedTenant("ov-other")
      const vacancies = await Promise.all(
        ["a", "b", "c", "d", "e", "f", "g"].map((label) => seedVacancyTitled(`ov-${label}`, `Vacancy ${label}`))
      )

      await insertApplication(tenant.userId, tenant.accountId, vacancies[0]!, {
        state: "submitted", submittedAgo: "2 hours", hhStatus: "INTERVIEW"
      })
      await insertApplication(tenant.userId, tenant.accountId, vacancies[1]!, {
        state: "submitted", submittedAgo: "3 hours", hhStatus: "VIEWED"
      })
      await insertApplication(tenant.userId, tenant.accountId, vacancies[2]!, {
        state: "submitted", submittedAgo: "5 days", hhStatus: "DISCARD"
      })
      await insertApplication(tenant.userId, tenant.accountId, vacancies[3]!, {
        state: "preparing", blockedReason: "daily_cap", retryIn: "30 minutes"
      })
      await insertApplication(tenant.userId, tenant.accountId, vacancies[4]!, {
        state: "needs_human", blockedReason: "captcha"
      })
      await insertApplication(tenant.userId, tenant.accountId, vacancies[5]!, { state: "draft" })
      // Импортированная вручную отправка: идёт в дневной лимит и в sentToday.
      await insertApplication(tenant.userId, tenant.accountId, vacancies[6]!, {
        state: "submitted", origin: "imported", submittedAgo: "1 hour"
      })

      // Чужие данные не должны попасть в снимок.
      const foreign = await seedVacancyTitled("ov-foreign", "Foreign vacancy")
      await insertApplication(other.userId, other.accountId, foreign, {
        state: "submitted", submittedAgo: "1 hour", hhStatus: "INTERVIEW"
      })
      const foreign2 = await seedVacancyTitled("ov-foreign2", "Foreign vacancy 2")
      await insertApplication(other.userId, other.accountId, foreign2, { state: "needs_human", blockedReason: "operator" })
      await enqueueJob({ userId: other.userId, accountId: other.accountId, stage: "reconcile" })

      await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read" })
      await runAs(
        "owner",
        ownerTx((tx) =>
          Effect.gen(function*() {
            yield* tx.execute(sql`
              insert into apply_filter (user_id, hh_account_id, auto_mode, daily_limit)
              values (${tenant.userId}, ${tenant.accountId}, 'auto', 50)
            `)
            yield* tx.execute(sql`
              insert into hh_captcha_episode (user_id, hh_account_id, submits_confirmed)
              values (${tenant.userId}, ${tenant.accountId}, 7)
            `)
          })
        )
      )

      const view = await overview(tenant.userId, 7)

      expect(view.days).toBe(7)
      expect(view.timeline).toHaveLength(7)
      expect(view.timeline.at(-1)!.day).toBe(new Date().toISOString().slice(0, 10))
      expect(view.timeline.reduce((n, d) => n + d.sent, 0)).toBe(view.funnel.sent)
      expect(view.funnel.vacanciesFound).toBeGreaterThanOrEqual(6)

      expect(view.applications.byState.draft).toBe(1)
      expect(view.applications.byState.preparing).toBe(1)
      expect(view.applications.byState.needs_human).toBe(1)
      expect(view.applications.draftsToReview).toBe(1)
      expect(view.applications.needsAttention).toEqual([
        expect.objectContaining({ state: "needs_human", reason: "captcha", count: 1 })
      ])
      expect(view.applications.waiting).toEqual([
        expect.objectContaining({ reason: "daily_cap", count: 1 })
      ])
      expect(view.applications.waiting[0]!.nextRetryAt).not.toBeNull()

      // Окно 7 суток: отправки otbor (2 часа, 3 часа, 5 суток назад) и импорт (1 час); чужая не считается.
      expect(view.applications.sentInWindow).toBe(4)
      expect(view.applications.sentPrevWindow).toBe(0)
      expect(view.applications.sentToday).toBe(3)
      expect(view.funnel.invited).toBe(1)
      expect(view.funnel.viewed).toBe(3)
      expect(view.funnel.rejected).toBe(1)
      expect(view.funnel.applicationsCreated).toBe(6)

      const account = view.accounts.find((a) => a.id === tenant.accountId)!
      expect(view.accounts).toHaveLength(1)
      expect(account.usage.limit).toBe(50)
      expect(account.usage.used).toBe(view.applications.sentToday)
      expect(String(view.accounts[0]!.id)).toBe(tenant.accountId)
      expect(account.usage.used).toBe(3)
      expect(account.usage.remaining).toBe(50 - account.usage.used)
      expect(account.autoModes).toEqual([{ resumeId: null, resumeTitle: null, autoMode: "auto" }])
      expect(account.captchas24h).toBe(1)
      expect(account.needsAttention).toBe(1)
      expect(account.active).toBe(1)
      expect(account.lastSentAt).not.toBeNull()

      expect(view.jobs.pending).toEqual([{ stage: "form_read", count: 1 }])
      expect(view.jobs.oldestPendingAgeSeconds).not.toBeNull()

      const kinds = view.events.map((e) => e.kind)
      expect(kinds).toContain("sent")
      expect(kinds).toContain("invited")
      expect(kinds).toContain("needs_human")
      expect(kinds).toContain("captcha")
      expect(view.events.map((e) => e.title)).not.toContain("Foreign vacancy")
      const times = view.events.map((e) => Date.parse(e.at))
      expect(times).toEqual([...times].sort((a, b) => b - a))
    })

    test("a user without data gets zeros, a zero-filled timeline and clamped days", async () => {
      const tenant = await seedTenant("ov-empty")
      await addAccount(tenant.userId, "second")
      const view = await overview(tenant.userId, 500)
      expect(view.days).toBe(60)
      expect(view.timeline).toHaveLength(60)
      expect(view.applications.byState.submitted).toBe(0)
      expect(view.applications.sentToday).toBe(0)
      expect(view.accounts).toHaveLength(2)
      expect(view.accounts[0]!.usage.limit).toBe(200)
      expect(view.accounts[0]!.autoModes).toEqual([])
      expect(view.jobs.oldestPendingAgeSeconds).toBeNull()
      expect(view.events).toEqual([])
      expect((await overview(tenant.userId, 0)).days).toBe(1)
      expect((await overview(tenant.userId)).days).toBe(14)
    })
  })
}
