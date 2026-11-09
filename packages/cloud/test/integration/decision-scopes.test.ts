/**
 * Решения принимаются для каждой пары (hh-аккаунт, резюме) отдельно: пересчёт
 * не зависит от аккаунта по умолчанию, правка фильтра одного аккаунта не делает
 * устаревшими решения другого, а автоотбор перед выбором пересчитывает устаревшее.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { VacancyId } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../src/db/Database.ts"
import { AutoApplyRunner } from "../../src/services/AutoApplyRunner.ts"
import { DecisionService } from "../../src/services/DecisionService.ts"
import * as support from "./support/index.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

if (!enabled || serverUrl === null) {
  test("decision scopes integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
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

  const evaluateBatch = (
    userId: string,
    input: { vacancyIds: ReadonlyArray<string>; hhAccountId?: string; resumeId?: string }
  ) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        return yield* (yield* DecisionService).evaluateBatch({
          ...input,
          vacancyIds: input.vacancyIds as ReadonlyArray<VacancyId>
        })
      })
    )

  const decisionsOf = (vacancyId: string) =>
    support.runAs(
      "owner",
      Effect.gen(function*() {
        const database = yield* Database
        return yield* database.asOwner((tx) =>
          tx
            .execute(
              sql`select hh_account_id::text as account, resume_id::text as resume, verdict
                  from decision where vacancy_id = ${vacancyId} order by created_at, id`
            )
            .pipe(
              Effect.map(
                (result) =>
                  result.rows as unknown as ReadonlyArray<{ account: string; resume: string | null; verdict: string }>
              )
            )
        )
      })
    )

  /** Пользователь с двумя аккаунтами; у каждого строка apply_filter и одно резюме. */
  const twoAccounts = async (label: string) => {
    const tenant = await support.seedTenant(label)
    const second = await support.addAccount(tenant.userId, `${label}-second`)
    const resumeA = await support.seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: `${label}-a` })
    const resumeB = await support.seedResume({ userId: tenant.userId, accountId: second, title: `${label}-b` })
    for (const accountId of [tenant.accountId, second]) {
      await support.applyFilterSet(tenant.userId, { hhAccountId: accountId, filter: {}, minFit: 0 })
    }
    return { userId: tenant.userId, accountA: tenant.accountId, accountB: second, resumeA, resumeB }
  }

  describe("decision scopes", () => {
    test("a sweep without an account decides for every account and resume, not for the default one", async () => {
      const ctx = await twoAccounts("ds-all")
      const vacancyId = await support.seedVacancyTitled("ds-all", "DevOps engineer ds-all")

      const result = await evaluateBatch(ctx.userId, { vacancyIds: [vacancyId] })
      expect(result.evaluated).toBe(2)

      const rows = await decisionsOf(vacancyId)
      expect(rows.map((row) => `${row.account}/${row.resume}`).sort()).toEqual(
        [`${ctx.accountA}/${ctx.resumeA}`, `${ctx.accountB}/${ctx.resumeB}`].sort()
      )

      // второй проход ничего не находит
      expect((await evaluateBatch(ctx.userId, { vacancyIds: [vacancyId] })).evaluated).toBe(0)
    }, 60_000)

    test("a fresh decision of one account does not hide the vacancy from another", async () => {
      const ctx = await twoAccounts("ds-fresh")
      const vacancyId = await support.seedVacancyTitled("ds-fresh", "DevOps engineer ds-fresh")

      expect((await evaluateBatch(ctx.userId, { vacancyIds: [vacancyId], hhAccountId: ctx.accountA })).evaluated).toBe(1)
      const second = await evaluateBatch(ctx.userId, { vacancyIds: [vacancyId], hhAccountId: ctx.accountB })
      expect(second.evaluated).toBe(1)
      expect(second.remaining).toBe(0)
    }, 60_000)

    test("editing the filter of one account leaves the decisions of the other current", async () => {
      const ctx = await twoAccounts("ds-edit")
      const vacancyId = await support.seedVacancyTitled("ds-edit", "DevOps engineer ds-edit")
      await evaluateBatch(ctx.userId, { vacancyIds: [vacancyId] })

      await support.applyFilterSet(ctx.userId, { hhAccountId: ctx.accountB, filter: {}, minFit: 10 })

      const forA = await evaluateBatch(ctx.userId, { vacancyIds: [vacancyId], hhAccountId: ctx.accountA })
      expect(forA.evaluated).toBe(0)
      const forB = await evaluateBatch(ctx.userId, { vacancyIds: [vacancyId], hhAccountId: ctx.accountB })
      expect(forB.evaluated).toBe(1)
    }, 60_000)

    test("every resume of an account gets its own decision", async () => {
      const tenant = await support.seedTenant("ds-resumes")
      const resume1 = await support.seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "ds-r1" })
      const resume2 = await support.seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "ds-r2" })
      // строка аккаунта покрывает оба резюме
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, minFit: 0 })
      const vacancyId = await support.seedVacancyTitled("ds-resumes", "DevOps engineer ds-resumes")

      expect((await evaluateBatch(tenant.userId, { vacancyIds: [vacancyId] })).evaluated).toBe(2)
      const rows = await decisionsOf(vacancyId)
      expect(rows.map((row) => row.resume).sort()).toEqual([resume1, resume2].sort())

      // правка фильтра пары пересчитывает только своё резюме
      await support.applyFilterSet(tenant.userId, {
        hhAccountId: tenant.accountId,
        resumeId: resume1 as never,
        filter: {},
        minFit: 5
      })
      expect((await evaluateBatch(tenant.userId, { vacancyIds: [vacancyId], resumeId: resume2 })).evaluated).toBe(0)
      expect((await evaluateBatch(tenant.userId, { vacancyIds: [vacancyId], resumeId: resume1 })).evaluated).toBe(1)
    }, 60_000)

    test("an auto-apply pass refreshes stale decisions of its account before selecting", async () => {
      const ctx = await twoAccounts("ds-runner")
      const vacancyId = await support.seedVacancyTitled("ds-runner", "DevOps engineer ds-runner")
      // решение устарело: после него правится фильтр аккаунта
      await support.runAs(
        ctx.userId,
        Effect.gen(function*() {
          return yield* (yield* DecisionService).evaluate({
            vacancyId: vacancyId as VacancyId,
            hhAccountId: ctx.accountA,
            resumeId: ctx.resumeA,
            fit: 90
          })
        })
      )
      await support.applyFilterSet(ctx.userId, {
        hhAccountId: ctx.accountA,
        filter: {},
        minFit: 0,
        autoMode: "drafts",
        batchSize: 500
      })

      const result = await support.runAs(
        ctx.userId,
        Effect.gen(function*() {
          return yield* (yield* AutoApplyRunner).run(ctx.userId, { hhAccountId: ctx.accountA })
        })
      )
      expect(result.selected).toBeGreaterThan(0)
      const created = await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          return yield* database.asOwner((tx) =>
            tx
              .execute(sql`select 1 from application where hh_account_id = ${ctx.accountA} and vacancy_id = ${vacancyId}`)
              .pipe(Effect.map((rows) => rows.rows.length))
          )
        })
      )
      expect(created).toBe(1)
    }, 60_000)
  })
}
