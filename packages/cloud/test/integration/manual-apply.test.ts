/**
 * Manual apply mode against a real Postgres: a vacancy chosen by the operator
 * is fetched into the corpus (fixture page, never hh.ru) and an application is
 * created WITHOUT a decision, with the same prepare job, one application per
 * (account, vacancy) and the unchanged approve guards.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { type FormAnswer, InvalidInput, type UserId } from "@otbor/contract"
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ApplicationService } from "../../src/services/ApplicationService.ts"
import { CurrentUser } from "../../src/services/CurrentUser.ts"
import { HydrationRunner, VacancyPageFetch } from "../../src/services/HydrationRunner.ts"
import * as support from "./support.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

const responseHtml = readFileSync(join(import.meta.dir, "../../../hh/test/fixtures", "hh-test-response.html"), "utf8")

const vacancyPage = (externalId: string, title: string): string =>
  `<html><body><template id="HH-Lux-InitialState">${
    JSON.stringify({
      vacancyView: {
        vacancyFull: {
          vacancy: {
            vacancyId: Number(externalId),
            name: title,
            description: `<p>${"Строим бэкенд на TypeScript и Postgres. ".repeat(20)}</p>`,
            keySkills: ["TypeScript", "PostgreSQL"],
            compensation: { from: 300000, to: 400000, currency: "RUB", gross: true },
            area: { id: 1, name: "Москва" },
            company: { id: 4242, visibleName: "Manual Co" },
            workExperience: "between3And6",
            employmentForm: "FULL",
            workFormats: ["REMOTE"],
            publicationTimeIso: "2026-10-31T12:00:00+03:00",
            status: { archived: false }
          }
        }
      }
    })
  }</template></body></html>`

const human = (questionId: string, extra: Partial<FormAnswer> = {}): FormAnswer => ({
  questionId,
  source: "human",
  hard: false,
  needsHuman: false,
  ...extra
})

if (!enabled || serverUrl === null) {
  test("manual-apply integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    expect(enabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousProxy = process.env.OTBOR_PROXY_URL
  const previousSub = process.env.OTBOR_PROXY_SUB_URL

  describe("manual apply mode", () => {
    beforeAll(async () => {
      await support.createTestDatabase(base)
      await support.migrateTestDatabase(base)
      process.env.DATABASE_URL = support.testDatabaseUrl(base)
      // An explicit endpoint wins over any local proxy file and never starts
      // the mihomo engine; the fake downloader below ignores it anyway.
      process.env.OTBOR_PROXY_URL = "http://127.0.0.1:9"
      delete process.env.OTBOR_PROXY_SUB_URL
    }, 120_000)

    afterAll(async () => {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
      if (previousProxy === undefined) delete process.env.OTBOR_PROXY_URL
      else process.env.OTBOR_PROXY_URL = previousProxy
      if (previousSub !== undefined) process.env.OTBOR_PROXY_SUB_URL = previousSub
      await support.dropTestDatabase(base)
    }, 60_000)

    const requested: Array<string> = []
    const pages = (html: string, status = 200) =>
      Effect.provideService(VacancyPageFetch, (url: string) => {
        requested.push(url)
        return Promise.resolve({ status, url, html })
      })

    const fetchVacancy = (userId: string, reference: string, html: string, status = 200) =>
      support.runAs(
        userId,
        Effect.gen(function*() {
          const runner = yield* HydrationRunner
          return yield* runner.fetchByReference(userId, reference)
        }).pipe(pages(html, status))
      )

    const createManual = (userId: string, vacancyId: string, hhAccountId: string) =>
      support.runAs(
        userId,
        Effect.gen(function*() {
          const applications = yield* ApplicationService
          return yield* applications.createManual({ vacancyId, hhAccountId })
        })
      )

    test("fetches one vacancy by URL into the corpus, then reuses it without a request", async () => {
      const tenant = await support.seedTenant("manual-fetch")
      requested.length = 0
      const externalId = "7700001"

      const first = await fetchVacancy(
        tenant.userId,
        `https://hh.ru/vacancy/${externalId}?hhtmFrom=vacancy_search_list`,
        vacancyPage(externalId, "Manual backend developer")
      )
      expect(first).toMatchObject({ externalId, title: "Manual backend developer", alreadyKnown: false })
      expect(requested).toEqual([`https://hh.ru/vacancy/${externalId}`])

      const again = await fetchVacancy(tenant.userId, externalId, vacancyPage(externalId, "never read"))
      expect(again).toMatchObject({ vacancyId: first.vacancyId, alreadyKnown: true })
      expect(requested).toHaveLength(1)
    }, 60_000)

    test("refuses foreign hosts, blocked answers and a page for another vacancy", async () => {
      const tenant = await support.seedTenant("manual-refuse")
      requested.length = 0

      const foreign = await support.runAsFailure(
        tenant.userId,
        Effect.gen(function*() {
          const runner = yield* HydrationRunner
          return yield* runner.fetchByReference(tenant.userId, "https://evil.example/vacancy/7700002")
        }).pipe(pages("<html></html>"))
      )
      expect(foreign).toBeInstanceOf(InvalidInput)
      expect(requested).toHaveLength(0)

      const blocked = await support.runAsFailure(
        tenant.userId,
        Effect.gen(function*() {
          const runner = yield* HydrationRunner
          return yield* runner.fetchByReference(tenant.userId, "7700003")
        }).pipe(pages("<html>forbidden</html>", 403))
      )
      expect(blocked).toBeInstanceOf(InvalidInput)
      expect((blocked as InvalidInput).message).toContain("HTTP 403")

      const mismatch = await support.runAsFailure(
        tenant.userId,
        Effect.gen(function*() {
          const runner = yield* HydrationRunner
          return yield* runner.fetchByReference(tenant.userId, "7700004")
        }).pipe(pages(vacancyPage("7700005", "Another vacancy")))
      )
      expect(mismatch).toBeInstanceOf(InvalidInput)
      expect((mismatch as InvalidInput).message).toContain("not 7700004")
    }, 60_000)

    test("creates a decision-less draft with a prepare job, once per account and vacancy", async () => {
      const tenant = await support.seedTenant("manual-create")
      const other = await support.addAccount(tenant.userId, "manual-other")
      // a vacancy nobody evaluated: no decision exists for it
      const vacancyId = await support.seedVacancy("manual-create")

      const first = await createManual(tenant.userId, vacancyId, tenant.accountId)
      expect(first.created).toBe(true)
      expect(first.application).toMatchObject({ state: "draft", vacancyId, decisionId: null })
      expect(await support.countJobs(first.application.id, "prepare")).toBe(1)

      const second = await createManual(tenant.userId, vacancyId, tenant.accountId)
      expect(second.created).toBe(false)
      expect(second.application.id).toBe(first.application.id)
      expect(await support.countJobs(first.application.id, "prepare")).toBe(1)

      // another account of the same user may apply to the same vacancy
      const third = await createManual(tenant.userId, vacancyId, other)
      expect(third.created).toBe(true)
      expect(third.application.id).not.toBe(first.application.id)
    }, 60_000)

    test("approve still enforces the kit and the at-most-once submit for a manual application", async () => {
      const tenant = await support.seedTenant("manual-approve")
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      const vacancyId = await support.seedVacancy("manual-approve")
      const externalId = await support.vacancyExternalId(vacancyId)
      const { application } = await createManual(tenant.userId, vacancyId, tenant.accountId)

      const leased = await support.leaseNext(tenant.userId, harness.id, harness.token!, [tenant.accountId])
      expect(leased.job?.stage).toBe("prepare")
      await support.completeJob(tenant.userId, {
        harnessId: harness.id,
        token: harness.token!,
        jobId: leased.job!.id,
        leaseId: leased.job!.leaseId!,
        epoch: leased.job!.leaseEpoch,
        exit: {
          tag: "prepared",
          artifacts: {
            url: `https://hh.ru/applicant/vacancy_response?vacancyId=${externalId}`,
            html: responseHtml
          }
        }
      })

      const detail = await support.applicationGet(tenant.userId, application.id)
      expect(detail.decision).toBeNull()
      expect(detail.form?.form.questions.length).toBeGreaterThan(0)

      const approve = support.runAsFailure(
        tenant.userId,
        Effect.gen(function*() {
          const applications = yield* ApplicationService
          return yield* applications.approve(application.id)
        }).pipe(Effect.provideService(CurrentUser, { userId: tenant.userId as UserId }))
      )
      // no kit yet: refused, nothing queued
      expect((await approve)._tag).toBe("Conflict")
      expect(await support.countJobs(application.id, "submit")).toBe(0)

      await support.applicationSetKit(tenant.userId, {
        applicationId: application.id,
        formHash: detail.form!.form.formHash,
        letter: "Здравствуйте",
        answers: [
          human("387049547", { optionIds: ["387049548"] }),
          human("387049551", { optionIds: ["387049553"] }),
          human("387049555", { text: "Москва" }),
          human("387049556", { optionIds: ["387049558"] }),
          human("387049560", { text: "300000 рублей" })
        ]
      })
      const approved = await support.runAs(
        tenant.userId,
        Effect.gen(function*() {
          const applications = yield* ApplicationService
          return yield* applications.approve(application.id)
        }).pipe(Effect.provideService(CurrentUser, { userId: tenant.userId as UserId }))
      )
      expect(approved.state).toBe("queued")
      expect(await support.countJobs(application.id, "submit")).toBe(1)

      // creating it again changes nothing
      const again = await createManual(tenant.userId, vacancyId, tenant.accountId)
      expect(again.created).toBe(false)
      expect(again.application.state).toBe("queued")
      expect(await support.countJobs(application.id, "submit")).toBe(1)
    }, 60_000)
  })
}
