/**
 * Список решений по id вакансии: возвращает только её решения (все аккаунты,
 * резюме и история), а вместе с latestPerVacancy - по одному свежему на аккаунт.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { VacancyId } from "@otbor/contract"
import { Effect } from "effect"
import { DecisionService } from "../../src/services/DecisionService.ts"
import * as support from "./support/index.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

if (!enabled || serverUrl === null) {
  test("decision by vacancy integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
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

  const decide = (userId: string, vacancyId: string, accountId: string, resumeId: string, fit: number) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        return yield* (yield* DecisionService).evaluate({
          vacancyId: vacancyId as VacancyId,
          hhAccountId: accountId,
          resumeId,
          fit
        })
      })
    )

  const list = (userId: string, options: { vacancyId?: string; latestPerVacancy?: boolean }) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        return yield* (yield* DecisionService).list({ limit: 200, ...options })
      })
    )

  describe("decision list by vacancy", () => {
    test("vacancyId keeps only that vacancy, across accounts, resumes and history", async () => {
      const tenant = await support.seedTenant("dbv")
      const second = await support.addAccount(tenant.userId, "dbv-second")
      const resumeA = await support.seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "dbv-a" })
      const resumeB = await support.seedResume({ userId: tenant.userId, accountId: second, title: "dbv-b" })
      const target = await support.seedVacancyTitled("dbv-target", "DevOps engineer dbv-target")
      const other = await support.seedVacancyTitled("dbv-other", "DevOps engineer dbv-other")

      await decide(tenant.userId, target, tenant.accountId, resumeA, 40)
      await decide(tenant.userId, target, tenant.accountId, resumeA, 70) // история: второе решение той же пары
      await decide(tenant.userId, target, second, resumeB, 55)
      await decide(tenant.userId, other, tenant.accountId, resumeA, 90)

      const all = await list(tenant.userId, { vacancyId: target })
      expect(all).toHaveLength(3)
      expect(all.every((row) => String(row.vacancyId) === target)).toBe(true)
      expect(new Set(all.map((row) => String(row.hhAccountId)))).toEqual(new Set([tenant.accountId, second]))

      const otherOnly = await list(tenant.userId, { vacancyId: other })
      expect(otherOnly.map((row) => String(row.vacancyId))).toEqual([other])

      // без vacancyId видны решения обеих вакансий
      expect((await list(tenant.userId, {})).length).toBe(4)
    }, 60_000)

    test("vacancyId with latestPerVacancy keeps the newest decision per account", async () => {
      const tenant = await support.seedTenant("dbv-latest")
      const second = await support.addAccount(tenant.userId, "dbv-latest-second")
      const resumeA = await support.seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "dbvl-a" })
      const resumeB = await support.seedResume({ userId: tenant.userId, accountId: second, title: "dbvl-b" })
      const target = await support.seedVacancyTitled("dbvl-target", "DevOps engineer dbvl-target")
      const other = await support.seedVacancyTitled("dbvl-other", "DevOps engineer dbvl-other")

      await decide(tenant.userId, target, tenant.accountId, resumeA, 40)
      const newestA = await decide(tenant.userId, target, tenant.accountId, resumeA, 70)
      const onlyB = await decide(tenant.userId, target, second, resumeB, 55)
      await decide(tenant.userId, other, tenant.accountId, resumeA, 90)

      const rows = await list(tenant.userId, { vacancyId: target, latestPerVacancy: true })
      expect(rows).toHaveLength(2)
      expect(rows.map((row) => String(row.id)).sort()).toEqual([String(newestA.id), String(onlyB.id)].sort())
    }, 60_000)

    test("a vacancy without decisions gives an empty list", async () => {
      const tenant = await support.seedTenant("dbv-empty")
      const lonely = await support.seedVacancyTitled("dbv-empty", "DevOps engineer dbv-empty")
      expect(await list(tenant.userId, { vacancyId: lonely })).toEqual([])
    }, 60_000)
  })
}
