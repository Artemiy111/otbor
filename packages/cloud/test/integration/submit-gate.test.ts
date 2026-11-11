/**
 * Единый шлюз отправки (`submitGate.trySubmit`) на настоящем Postgres: режим
 * auto, учёт всех откликов аккаунта в лимите, гонка за последний слот,
 * свежесть формы, retry без неявного одобрения и сбои чтения формы разных
 * аккаунтов. hh.ru не вызывается: страницы - локальные фикстуры packages/hh.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { type FormAnswer, LimitExceeded, type UserId } from "@otbor/contract"
import { parseResponseForm } from "@otbor/hh"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "../../src/db/Database.ts"
import { ApplicationService } from "../../src/services/ApplicationService.ts"
import { CurrentUser } from "../../src/services/CurrentUser.ts"
import * as support from "./support/index.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

const responseHtml = readFileSync(join(import.meta.dir, "../../../hh/test/fixtures", "hh-test-response.html"), "utf8")

const human = (questionId: string, extra: Partial<FormAnswer> = {}): FormAnswer => ({
  questionId,
  source: "human",
  hard: false,
  needsHuman: false,
  ...extra
})

const fullAnswers = (): ReadonlyArray<FormAnswer> => [
  human("387049547", { optionIds: ["387049548"] }),
  human("387049551", { optionIds: ["387049553"] }),
  human("387049555", { text: "Москва" }),
  human("387049556", { optionIds: ["387049558"] }),
  human("387049560", { text: "300000 рублей" })
]

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000)

if (!enabled || serverUrl === null) {
  test("submit-gate integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    expect(enabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  describe("submit gate", () => {
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

    const urlFor = (externalId: string) => `https://hh.ru/applicant/vacancy_response?vacancyId=${externalId}`

    /** Читает форму вакансии сеансом аккаунта: prepare-задача, lease, complete. */
    const readForm = async (
      tenant: support.Tenant,
      harness: { id: string; token?: string | null },
      accounts: ReadonlyArray<string>,
      input: { accountId: string; vacancyId: string; exit?: "form" | "session_expired" }
    ) => {
      const externalId = await support.vacancyExternalId(input.vacancyId)
      await support.enqueuePrepareJob({
        userId: tenant.userId,
        accountId: input.accountId,
        vacancyId: input.vacancyId,
        externalId
      })
      const leased = await support.leaseNext(tenant.userId, harness.id, harness.token!, accounts)
      expect(leased.job?.stage).toBe("form_read")
      await support.completeJob(tenant.userId, {
        harnessId: harness.id,
        token: harness.token!,
        jobId: leased.job!.id,
        leaseId: leased.job!.leaseId!,
        epoch: leased.job!.leaseEpoch,
        exit:
          input.exit === "session_expired"
            ? { tag: "session_expired" }
            : { tag: "prepared", artifacts: { url: urlFor(externalId), html: responseHtml } }
      })
    }

    const formHashOf = async (vacancyId: string) =>
      parseResponseForm(responseHtml, urlFor(await support.vacancyExternalId(vacancyId))).formHash

    const setFullKit = async (userId: string, applicationId: string, vacancyId: string) =>
      support.applicationSetKit(userId, {
        applicationId,
        formHash: await formHashOf(vacancyId),
        letter: "Здравствуйте",
        answers: fullAnswers()
      })

    const rowOf = (applicationId: string) =>
      support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          const result = yield* database.asOwner((tx) =>
            tx.execute(sql`select state, intent_at, last_error from application where id = ${applicationId}`)
          )
          return result.rows[0] as unknown as { state: string; intent_at: Date | null; last_error: string | null }
        })
      )

    const autoOn = (tenant: support.Tenant, accountId = tenant.accountId, extra: { dailyLimit?: number } = {}) =>
      support.applyFilterSet(tenant.userId, { hhAccountId: accountId, filter: {}, autoMode: "auto", ...extra })

    const asUser = <A, E>(userId: string, effect: Effect.Effect<A, E, ApplicationService | CurrentUser>) =>
      support.runAs(
        userId,
        effect.pipe(
          Effect.provide(ApplicationService.layerWith({ dailyApplyLimit: 200 })),
          Effect.provideService(CurrentUser, { userId: userId as UserId })
        )
      )

    const usage = (tenant: support.Tenant) =>
      asUser(
        tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* ApplicationService).dailyUsage(tenant.accountId)
        })
      )

    /** Черновик с прочитанной формой и полным китом, готовый к approve. */
    const readyDraft = async (
      tenant: support.Tenant,
      harness: { id: string; token?: string | null },
      label: string
    ) => {
      const vacancyId = await support.seedVacancy(label)
      const applicationId = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        state: "draft"
      })
      await readForm(tenant, harness, [tenant.accountId], { accountId: tenant.accountId, vacancyId })
      await setFullKit(tenant.userId, applicationId, vacancyId)
      return applicationId
    }

    test("turning auto off demotes waiting auto applications and a form read then submits nothing", async () => {
      const tenant = await support.seedTenant("gate-off")
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      await autoOn(tenant)
      const vacancyId = await support.seedVacancy("gate-off")
      const id = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        state: "preparing",
        autoRun: "auto"
      })
      // Кит есть, формы ещё нет: заявка ждёт чтения.
      await setFullKit(tenant.userId, id, vacancyId)
      expect((await rowOf(id)).state).toBe("preparing")

      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, autoMode: "off" })
      const demoted = await rowOf(id)
      expect(demoted.state).toBe("draft")
      expect(demoted.last_error).toBe("auto mode was turned off; nothing was sent")

      await readForm(tenant, harness, [tenant.accountId], { accountId: tenant.accountId, vacancyId })
      expect((await rowOf(id)).state).toBe("draft")
      expect(await support.countJobs(id, "submit")).toBe(0)
    }, 60_000)

    test("an application already holding its slot is not demoted when auto is turned off", async () => {
      const tenant = await support.seedTenant("gate-off-sent")
      await autoOn(tenant)
      const id = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId: await support.seedVacancy("gate-off-sent"),
        state: "queued",
        autoRun: "auto",
        intentAt: new Date()
      })
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, autoMode: "drafts" })
      expect((await rowOf(id)).state).toBe("queued")
    }, 60_000)

    test("a pair row in auto keeps its applications when the account row is off", async () => {
      const tenant = await support.seedTenant("gate-pair")
      const resumeId = await support.seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "gate-pair" })
      await support.applyFilterSet(tenant.userId, {
        hhAccountId: tenant.accountId,
        resumeId,
        filter: {},
        autoMode: "auto"
      })
      const id = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId: await support.seedVacancy("gate-pair"),
        state: "preparing",
        autoRun: "auto",
        resumeId
      })
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, autoMode: "off" })
      expect((await rowOf(id)).state).toBe("preparing")
      await support.applyFilterSet(tenant.userId, {
        hhAccountId: tenant.accountId,
        resumeId,
        filter: {},
        autoMode: "off"
      })
      expect((await rowOf(id)).state).toBe("draft")
    }, 60_000)

    test("a manual application in queued with a kit is not submitted by a form read", async () => {
      const tenant = await support.seedTenant("gate-manual")
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      await autoOn(tenant)
      const vacancyId = await support.seedVacancy("gate-manual")
      const id = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        state: "queued"
      })
      await setFullKit(tenant.userId, id, vacancyId)
      await readForm(tenant, harness, [tenant.accountId], { accountId: tenant.accountId, vacancyId })
      expect(await support.countJobs(id, "submit")).toBe(0)
      expect((await rowOf(id)).intent_at).toBeNull()
    }, 60_000)

    test("an auto application of any account goes out on a form read, but only when its row is auto", async () => {
      const tenant = await support.seedTenant("gate-any")
      const other = await support.addAccount(tenant.userId, "gate-any-b")
      const accounts = [tenant.accountId, other]
      const harness = await support.registerHarness(tenant.userId, accounts)
      await autoOn(tenant)
      await autoOn(tenant, other)
      const vacancyId = await support.seedVacancy("gate-any")
      const mine = await support.seedApplication({
        userId: tenant.userId, accountId: tenant.accountId, vacancyId, state: "preparing", autoRun: "auto"
      })
      const theirs = await support.seedApplication({
        userId: tenant.userId, accountId: other, vacancyId, state: "preparing", autoRun: "auto"
      })
      await setFullKit(tenant.userId, mine, vacancyId)
      await setFullKit(tenant.userId, theirs, vacancyId)

      await readForm(tenant, harness, accounts, { accountId: tenant.accountId, vacancyId })
      expect(await support.countJobs(mine, "submit")).toBe(1)
      expect(await support.countJobs(theirs, "submit")).toBe(1)
      expect((await rowOf(theirs)).intent_at).not.toBeNull()
    }, 60_000)

    test("require_letter: an auto application without a letter is not sent, with the switch off it is", async () => {
      const tenant = await support.seedTenant("gate-letter")
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      await support.applyFilterSet(tenant.userId, {
        hhAccountId: tenant.accountId, filter: {}, autoMode: "auto", requireLetter: true
      })
      const vacancyId = await support.seedVacancy("gate-letter")
      const applicationId = await support.seedApplication({
        userId: tenant.userId, accountId: tenant.accountId, vacancyId, state: "preparing", autoRun: "auto"
      })
      await support.applicationSetKit(tenant.userId, {
        applicationId,
        formHash: await formHashOf(vacancyId),
        letter: null,
        answers: fullAnswers()
      })

      await readForm(tenant, harness, [tenant.accountId], { accountId: tenant.accountId, vacancyId })
      expect(await support.countJobs(applicationId, "submit")).toBe(0)
      expect((await rowOf(applicationId)).state).toBe("needs_human")
    }, 60_000)

    test("a failed form read of account A does not park the application of account B", async () => {
      const tenant = await support.seedTenant("gate-park")
      const other = await support.addAccount(tenant.userId, "gate-park-b")
      const accounts = [tenant.accountId, other]
      const harness = await support.registerHarness(tenant.userId, accounts)
      await autoOn(tenant)
      await autoOn(tenant, other)
      const vacancyId = await support.seedVacancy("gate-park")
      const a = await support.seedApplication({
        userId: tenant.userId, accountId: tenant.accountId, vacancyId, state: "preparing", autoRun: "auto"
      })
      const b = await support.seedApplication({
        userId: tenant.userId, accountId: other, vacancyId, state: "preparing", autoRun: "auto"
      })

      await readForm(tenant, harness, accounts, { accountId: tenant.accountId, vacancyId, exit: "session_expired" })
      expect((await rowOf(a)).state).toBe("needs_human")
      expect((await rowOf(b)).state).toBe("preparing")
      expect((await rowOf(b)).last_error).toBeNull()
    }, 60_000)

    test("a stale stored form blocks an auto send until it is read again", async () => {
      const tenant = await support.seedTenant("gate-stale")
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      await autoOn(tenant)
      const vacancyId = await support.seedVacancy("gate-stale")
      const id = await support.seedApplication({
        userId: tenant.userId, accountId: tenant.accountId, vacancyId, state: "preparing", autoRun: "auto"
      })
      await readForm(tenant, harness, [tenant.accountId], { accountId: tenant.accountId, vacancyId })
      await support.ageVacancyForm(vacancyId, 25)

      await setFullKit(tenant.userId, id, vacancyId)
      expect(await support.countJobs(id, "submit")).toBe(0)
      const waiting = await rowOf(id)
      expect(waiting.state).toBe("preparing")
      expect(waiting.intent_at).toBeNull()

      // Форму перечитали: заявка, ждавшая в preparing, уходит.
      await readForm(tenant, harness, [tenant.accountId], { accountId: tenant.accountId, vacancyId })
      expect(await support.countJobs(id, "submit")).toBe(1)
    }, 60_000)

    test("responses imported in the last 24 hours reduce the budget, old ones do not", async () => {
      const tenant = await support.seedTenant("gate-imported")
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, dailyLimit: 3 })

      // Расширение браузера: submitted_at и hh_responded_at - сейчас.
      await support.seedApplication({
        userId: tenant.userId, accountId: tenant.accountId, vacancyId: await support.seedVacancy("imp-1"),
        state: "submitted", origin: "imported", submittedAt: new Date(), hhRespondedAt: new Date()
      })
      // Синхронизация: только hh_responded_at, час назад.
      await support.seedApplication({
        userId: tenant.userId, accountId: tenant.accountId, vacancyId: await support.seedVacancy("imp-2"),
        state: "submitted", origin: "imported", hhRespondedAt: hoursAgo(1)
      })
      // Старый отклик, который синхронизация импортировала только что: не свежий.
      await support.seedApplication({
        userId: tenant.userId, accountId: tenant.accountId, vacancyId: await support.seedVacancy("imp-3"),
        state: "submitted", origin: "imported", submittedAt: new Date(), hhRespondedAt: hoursAgo(30)
      })
      // Импорт без даты отклика не считается недавним.
      await support.seedApplication({
        userId: tenant.userId, accountId: tenant.accountId, vacancyId: await support.seedVacancy("imp-4"),
        state: "submitted", origin: "imported"
      })

      expect(await usage(tenant)).toMatchObject({ used: 2, limit: 3, remaining: 1 })

      const first = await readyDraft(tenant, harness, "imp-ready-1")
      const second = await readyDraft(tenant, harness, "imp-ready-2")
      expect(
        (await asUser(tenant.userId, Effect.gen(function*() { return yield* (yield* ApplicationService).approve(first) })))
          .state
      ).toBe("queued")
      const refused = await support.runAsFailure(
        tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* ApplicationService).approve(second)
        }).pipe(
          Effect.provide(ApplicationService.layerWith({ dailyApplyLimit: 200 })),
          Effect.provideService(CurrentUser, { userId: tenant.userId as UserId })
        )
      )
      expect(refused).toBeInstanceOf(LimitExceeded)
      expect((refused as LimitExceeded).used).toBe(3)
    }, 60_000)

    test("concurrent approvals cannot both take the last slot", async () => {
      const tenant = await support.seedTenant("gate-race")
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, dailyLimit: 1 })
      const ids = [
        await readyDraft(tenant, harness, "race-1"),
        await readyDraft(tenant, harness, "race-2"),
        await readyDraft(tenant, harness, "race-3")
      ]
      const results = await Promise.all(
        ids.map((id) =>
          support
            .runAs(
              tenant.userId,
              Effect.gen(function*() {
                return yield* (yield* ApplicationService).approve(id).pipe(Effect.result)
              }).pipe(
                Effect.provide(ApplicationService.layerWith({ dailyApplyLimit: 200 })),
                Effect.provideService(CurrentUser, { userId: tenant.userId as UserId })
              )
            )
        )
      )
      expect(results.filter((result) => result._tag === "Success")).toHaveLength(1)
      expect(await usage(tenant)).toMatchObject({ used: 1, limit: 1, remaining: 0 })
    }, 60_000)

    test("retry of a manual application lands in draft, not in an implicit approval", async () => {
      const tenant = await support.seedTenant("gate-retry")
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      await autoOn(tenant)
      const vacancyId = await support.seedVacancy("gate-retry")
      const id = await support.seedApplication({
        userId: tenant.userId, accountId: tenant.accountId, vacancyId, state: "failed"
      })
      await setFullKit(tenant.userId, id, vacancyId)

      const retried = await support.applicationRetry(tenant.userId, id)
      expect(retried.state).toBe("draft")

      // Новое чтение формы ничего не отправляет: решает оператор.
      await readForm(tenant, harness, [tenant.accountId], { accountId: tenant.accountId, vacancyId })
      expect((await rowOf(id)).state).toBe("draft")
      expect(await support.countJobs(id, "submit")).toBe(0)
    }, 60_000)

    test("retry of an auto application goes back to the runner only while its row is auto", async () => {
      const tenant = await support.seedTenant("gate-retry-auto")
      const vacancyId = await support.seedVacancy("gate-retry-auto")
      const id = await support.seedApplication({
        userId: tenant.userId, accountId: tenant.accountId, vacancyId, state: "needs_human", autoRun: "auto"
      })

      const off = await support.applicationRetry(tenant.userId, id)
      expect(off.state).toBe("draft")

      await autoOn(tenant)
      await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          yield* database.asOwner((tx) => tx.execute(sql`update application set state = 'needs_human' where id = ${id}`))
        })
      )
      const on = await support.applicationRetry(tenant.userId, id)
      expect(on.state).toBe("preparing")
      expect((await rowOf(id)).intent_at).toBeNull()
    }, 60_000)
  })
}
