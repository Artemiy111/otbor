/** Integration: ApplicationsSearch (страница откликов с итогом). See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { ApplicationService } from "../../src/services/ApplicationService.ts"
import {
  addAccount,
  createTestDatabase,
  dropTestDatabase,
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

  const search = (userId: string, options: Parameters<ApplicationService["Service"]["search"]>[0]) =>
    runAs(
      userId,
      Effect.gen(function*() {
        const service = yield* ApplicationService
        return yield* service.search(options)
      })
    )

  const insert = (
    userId: string,
    accountId: string,
    vacancyId: string,
    fields: { readonly state: string; readonly blockedReason?: string; readonly autoRun?: string }
  ) =>
    runAs(
      userId,
      ownerTx((tx) =>
        tx.execute(sql`
          insert into application (user_id, hh_account_id, vacancy_id, state, blocked_reason, auto_run)
          values (${userId}, ${accountId}, ${vacancyId}, ${fields.state},
                  ${fields.blockedReason ?? null}, ${fields.autoRun ?? null})
        `)
      )
    )

  describe("ApplicationsSearch", () => {
    test("pages with a real total, filters by state, reason, mode, account and text, counts per state", async () => {
      const tenant = await seedTenant("as-mine")
      const second = await addAccount(tenant.userId, "as-second")
      const other = await seedTenant("as-other")

      const titles = ["Rust dev", "Go dev", "100% Python", "Java dev", "Kotlin dev"]
      const vacancies = await Promise.all(titles.map((title, index) => seedVacancyTitled(`as-${index}`, title)))
      await insert(tenant.userId, tenant.accountId, vacancies[0]!, { state: "needs_human", blockedReason: "captcha" })
      await insert(tenant.userId, tenant.accountId, vacancies[1]!, { state: "needs_human", blockedReason: "no_resume", autoRun: "auto" })
      await insert(tenant.userId, tenant.accountId, vacancies[2]!, { state: "draft", autoRun: "drafts" })
      await insert(tenant.userId, tenant.accountId, vacancies[3]!, { state: "submitted" })
      await insert(tenant.userId, second, vacancies[4]!, { state: "failed", blockedReason: "captcha" })
      // Чужой отклик не виден ни в итоге, ни в счётчиках.
      const foreign = await seedVacancyTitled("as-foreign", "Foreign dev")
      await insert(other.userId, other.accountId, foreign, { state: "needs_human", blockedReason: "captcha" })

      const all = await search(tenant.userId, {})
      expect(all.total).toBe(5)
      expect(all.items).toHaveLength(5)
      expect(all.byState).toEqual({ needs_human: 2, draft: 1, submitted: 1, failed: 1 })

      // Страница меньше итога: total остаётся настоящим, offset сдвигает окно.
      const first = await search(tenant.userId, { limit: 2, offset: 0 })
      const next = await search(tenant.userId, { limit: 2, offset: 2 })
      const last = await search(tenant.userId, { limit: 2, offset: 4 })
      expect([first.total, next.total, last.total]).toEqual([5, 5, 5])
      expect([first.items.length, next.items.length, last.items.length]).toEqual([2, 2, 1])
      const ids = [...first.items, ...next.items, ...last.items].map((item) => item.id)
      expect(new Set(ids).size).toBe(5)

      const attention = await search(tenant.userId, { states: ["needs_human", "failed", "draft"] })
      expect(attention.total).toBe(4)

      const captcha = await search(tenant.userId, { states: ["needs_human", "failed"], blockedReason: "captcha" })
      expect(captcha.total).toBe(2)

      expect((await search(tenant.userId, { mode: "manual" })).total).toBe(3)
      expect((await search(tenant.userId, { mode: "any_auto" })).total).toBe(2)
      expect((await search(tenant.userId, { mode: "drafts" })).total).toBe(1)

      // Аккаунт сужает и итог, и счётчики.
      const scoped = await search(tenant.userId, { hhAccountId: second })
      expect(scoped.total).toBe(1)
      expect(scoped.byState).toEqual({ failed: 1 })

      // Фильтры не меняют счётчики вкладок.
      const filtered = await search(tenant.userId, { states: ["draft"] })
      expect(filtered.total).toBe(1)
      expect(filtered.byState.needs_human).toBe(2)

      // Поиск по названию; служебные символы шаблона ищутся буквально.
      expect((await search(tenant.userId, { search: "rust" })).total).toBe(1)
      expect((await search(tenant.userId, { search: "100%" })).items.map((item) => item.vacancyTitle)).toEqual(["100% Python"])
      expect((await search(tenant.userId, { search: "%" })).total).toBe(1)
    })
  })
}
