/**
 * The operator's own browser on hh.ru (the extension): drafts for the response
 * form, and recording a response the operator sent with hh's own button.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { FormAnswer } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import * as ApplicationRepository from "../../src/repositories/ApplicationRepository.ts"
import { BrowserApply, type BrowserSubmitInput } from "../../src/services/BrowserApply.ts"
import * as support from "./support/index.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

const RESPONDED = '<div data-qa="responded-success-attach-cover-letter">Вы откликнулись</div>'

const human = (questionId: string, extra: Partial<FormAnswer> = {}): FormAnswer => ({
  questionId,
  source: "human",
  hard: false,
  needsHuman: false,
  ...extra
})

const input = (externalId: string, extra: Partial<BrowserSubmitInput> = {}): BrowserSubmitInput => ({
  kind: "submit",
  externalId,
  resumeTitle: null,
  letter: null,
  answers: [],
  formHash: null,
  url: `https://hh.ru/applicant/vacancy_response?vacancyId=${externalId}`,
  evidence: RESPONDED,
  ...extra
})

if (!enabled || serverUrl === null) {
  test("browser-apply integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    expect(enabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  describe("browser apply", () => {
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

    const drafts = (userId: string, externalId: string) =>
      support.runAs(userId, Effect.flatMap(BrowserApply, (service) => service.drafts(externalId)))
    const record = (userId: string, payload: BrowserSubmitInput) =>
      support.runAs(userId, Effect.flatMap(BrowserApply, (service) => service.recordSubmit(payload)))
    const kitOf = (userId: string, applicationId: string) =>
      support.runAs(userId, support.ownerTx((tx) => ApplicationRepository.findKit(tx, applicationId)))
    const appRow = (userId: string, applicationId: string) =>
      support.runAs(
        userId,
        support.ownerTx((tx) =>
          tx
            .execute(sql`select state, origin, submitted_at from application where id = ${applicationId}`)
            .pipe(Effect.map((result) => result.rows[0] as { state: string; origin: string; submitted_at: Date | null }))
        )
      )

    test("a draft's kit is offered for its vacancy, matched by resume title", async () => {
      const tenant = await support.seedTenant("browser-drafts")
      const externalId = String(7_000_000 + Math.floor(Math.random() * 1_000_000))
      const vacancyId = await support.seedVacancyWithExternal(externalId, "Browser drafts")
      const resumeId = await support.seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "Backend TS" })
      const applicationId = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        resumeId,
        state: "draft"
      })
      await support.seedKit({ userId: tenant.userId, applicationId })

      const result = await drafts(tenant.userId, externalId)
      expect(result.vacancyId).toBe(vacancyId as never)
      expect(result.drafts).toHaveLength(1)
      expect(result.drafts[0]).toMatchObject({ applicationId, resumeTitle: "Backend TS", state: "draft", letter: "integration test" })

      expect((await drafts(tenant.userId, "1")).vacancyId).toBeNull()
      // Another user sees nothing of it.
      const other = await support.seedTenant("browser-drafts-other")
      expect((await drafts(other.userId, externalId)).drafts).toHaveLength(0)
    })

    test("a browser submit settles the draft and stores what was on the form", async () => {
      const tenant = await support.seedTenant("browser-submit")
      const externalId = String(8_000_000 + Math.floor(Math.random() * 1_000_000))
      const vacancyId = await support.seedVacancyWithExternal(externalId, "Browser submit")
      const resumeId = await support.seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "Frontend" })
      const applicationId = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        resumeId,
        state: "draft"
      })

      const answers = [human("1", { optionIds: ["11"] }), human("2", { text: "три года" })]
      const result = await record(
        tenant.userId,
        input(externalId, { resumeTitle: "Frontend", letter: "Здравствуйте", answers, formHash: "hash-1" })
      )
      expect(result.status).toBe("recorded")
      expect(result.application?.id).toBe(applicationId as never)
      const row = await appRow(tenant.userId, applicationId)
      expect(row.state).toBe("submitted")
      expect(row.origin).toBe("otbor")
      expect(row.submitted_at).not.toBeNull()
      const kit = await kitOf(tenant.userId, applicationId)
      expect(kit).toMatchObject({ formHash: "hash-1", letter: "Здравствуйте" })
      expect(kit?.answers).toHaveLength(2)

      // The same click reported twice changes nothing.
      expect((await record(tenant.userId, input(externalId, { resumeTitle: "Frontend" }))).status).toBe("already")
    })

    test("without a draft the response is stored as imported; without evidence nothing is", async () => {
      const tenant = await support.seedTenant("browser-new")
      const externalId = String(9_000_000 + Math.floor(Math.random() * 500_000))
      const vacancyId = await support.seedVacancyWithExternal(externalId, "Browser new")

      const unconfirmed = await record(tenant.userId, input(externalId, { evidence: "<form>Откликнуться</form>" }))
      expect(unconfirmed.status).toBe("unconfirmed")

      const result = await record(tenant.userId, input(externalId, { letter: "Письмо" }))
      expect(result.status).toBe("recorded")
      expect(result.application).toMatchObject({ vacancyId, state: "submitted", origin: "imported" })
      expect(await kitOf(tenant.userId, result.application!.id)).toMatchObject({ letter: "Письмо", formHash: "no-form" })
    })

    test("an otbor submit in flight is left to the reconcile", async () => {
      const tenant = await support.seedTenant("browser-inflight")
      const externalId = String(9_500_000 + Math.floor(Math.random() * 400_000))
      const vacancyId = await support.seedVacancyWithExternal(externalId, "Browser in flight")
      const applicationId = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        state: "queued"
      })
      await support.enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, applicationId, stage: "submit" })
      expect((await record(tenant.userId, input(externalId))).status).toBe("in_flight")
      expect((await appRow(tenant.userId, applicationId)).state).toBe("queued")
    })

    test("a letter added to a sent response is stored and its unsent draft dropped", async () => {
      const tenant = await support.seedTenant("browser-letter")
      const externalId = String(9_900_000 + Math.floor(Math.random() * 90_000))
      const vacancyId = await support.seedVacancyWithExternal(externalId, "Browser letter")
      const applicationId = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        state: "submitted"
      })
      await support.runAs(
        tenant.userId,
        support.ownerTx((tx) =>
          tx.execute(sql`insert into letter_draft (user_id, hh_account_id, vacancy_id, resume_id, letter)
            values (${tenant.userId}, ${tenant.accountId}, ${vacancyId}, '00000000-0000-0000-0000-000000000000', 'Черновик')`)
        )
      )
      expect((await drafts(tenant.userId, externalId)).drafts[0]?.pendingLetter).toBe("Черновик")

      const result = await record(tenant.userId, input(externalId, { kind: "letter", letter: "Черновик" }))
      expect(result.status).toBe("recorded")
      expect(await kitOf(tenant.userId, applicationId)).toMatchObject({ letter: "Черновик" })
      expect((await drafts(tenant.userId, externalId)).drafts[0]?.pendingLetter).toBeNull()
    })
  })
}
