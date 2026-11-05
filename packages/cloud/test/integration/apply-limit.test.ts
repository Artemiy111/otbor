/**
 * The daily submit limit per hh account, against a real Postgres. This is the
 * server-side safety net behind every front end (CLI, web, MCP chat): approve
 * refuses with a typed `LimitExceeded` once an account used its slots in the
 * last 24 hours. No hh.ru: pages are the local fixtures of packages/hh.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { type FormAnswer, LimitExceeded, type UserId } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { parseResponseForm } from "@otbor/hh"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "../../src/db/Database.ts"
import { CurrentUser } from "../../src/services/CurrentUser.ts"
import { ApplicationService, DEFAULT_DAILY_APPLY_LIMIT } from "../../src/services/ApplicationService.ts"
import * as support from "./support.ts"

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

if (!enabled || serverUrl === null) {
  test("apply-limit integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    expect(enabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  describe("daily apply limit", () => {
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

    /** A draft application with a prepared form and a full kit, ready to approve. */
    const ready = async (
      tenant: support.Tenant,
      accountId: string,
      harness: { id: string; token?: string | null },
      accounts: ReadonlyArray<string>,
      label: string
    ) => {
      const vacancyId = await support.seedVacancy(label)
      const externalId = await support.vacancyExternalId(vacancyId)
      const applicationId = await support.seedApplication({
        userId: tenant.userId,
        accountId,
        vacancyId,
        state: "draft"
      })
      await support.enqueuePrepareJob({
        userId: tenant.userId,
        accountId,
        applicationId,
        vacancyId,
        externalId,
        sequence: 1
      })
      const leased = await support.leaseNext(tenant.userId, harness.id, harness.token!, accounts)
      expect(leased.job?.stage).toBe("form_read")
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
      const form = (await support.applicationGet(tenant.userId, applicationId)).form!.form
      await support.applicationSetKit(tenant.userId, {
        applicationId,
        formHash: form.formHash,
        letter: "Здравствуйте",
        answers: fullAnswers()
      })
      return applicationId
    }

    /** Approve with the limit pinned to two, whatever the environment says. */
    const limited = ApplicationService.layerWith({ dailyApplyLimit: 2 })
    const approve = (userId: string, id: string) =>
      support.runAs(
        userId,
        Effect.gen(function*() {
          const applications = yield* ApplicationService
          return yield* applications.approve(id)
        }).pipe(Effect.provide(limited), Effect.provideService(CurrentUser, { userId: userId as UserId }))
      )
    const approveFailure = (userId: string, id: string) =>
      support.runAs(
        userId,
        Effect.gen(function*() {
          const applications = yield* ApplicationService
          return yield* applications.approve(id).pipe(Effect.flip)
        }).pipe(Effect.provide(limited), Effect.provideService(CurrentUser, { userId: userId as UserId }))
      )

    /** Pretend the approval happened `hours` ago. */
    const backdate = (applicationId: string, hours: number) =>
      support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          yield* database.asOwner((tx) =>
            tx.execute(
              sql`update application set intent_at = now() - make_interval(hours => ${hours}) where id = ${applicationId}`
            )
          )
        })
      )

    test("approve stops at the per-account limit with a typed LimitExceeded", async () => {
      const tenant = await support.seedTenant("limit")
      const other = await support.addAccount(tenant.userId, "limit-other")
      const accounts = [tenant.accountId, other]
      const harness = await support.registerHarness(tenant.userId, accounts)

      const one = await ready(tenant, tenant.accountId, harness, accounts, "limit-1")
      const two = await ready(tenant, tenant.accountId, harness, accounts, "limit-2")
      const three = await ready(tenant, tenant.accountId, harness, accounts, "limit-3")
      const elsewhere = await ready(tenant, other, harness, accounts, "limit-4")

      expect((await approve(tenant.userId, one)).state).toBe("queued")
      expect((await approve(tenant.userId, two)).state).toBe("queued")

      const refused = await approveFailure(tenant.userId, three)
      expect(refused).toBeInstanceOf(LimitExceeded)
      const limit = refused as LimitExceeded
      expect(limit.limit).toBe(2)
      expect(limit.used).toBe(2)
      // the oldest approval was moments ago: the slot frees about 24 hours from now
      const resets = Date.parse(limit.resetsAt)
      expect(resets).toBeGreaterThan(Date.now() + 23 * 3_600_000)
      expect(resets).toBeLessThanOrEqual(Date.now() + 24 * 3_600_000 + 1_000)

      // nothing was queued for the refused application and it is still a draft
      expect(await support.countJobs(three, "submit")).toBe(0)
      expect((await support.findApplication(three))?.state).toBe("draft")

      // the limit is per hh account: another account of the same user is free
      expect((await approve(tenant.userId, elsewhere)).state).toBe("queued")

      // approvals older than 24 hours leave the window
      await backdate(one, 25)
      expect((await approve(tenant.userId, three)).state).toBe("queued")
      expect(await support.countJobs(three, "submit")).toBe(1)
    }, 60_000)

    test("a refused approve does not consume a slot and can be repeated later", async () => {
      const tenant = await support.seedTenant("limit-repeat")
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      const accounts = [tenant.accountId]
      const a = await ready(tenant, tenant.accountId, harness, accounts, "limit-r1")
      const b = await ready(tenant, tenant.accountId, harness, accounts, "limit-r2")
      const c = await ready(tenant, tenant.accountId, harness, accounts, "limit-r3")
      await approve(tenant.userId, a)
      await approve(tenant.userId, b)

      for (let i = 0; i < 2; i++) {
        const refused = await approveFailure(tenant.userId, c)
        expect(refused).toBeInstanceOf(LimitExceeded)
        expect((refused as LimitExceeded).used).toBe(2)
      }
    }, 60_000)

    test("the default limit is 200 and usage reports used, remaining and oldest", async () => {
      const tenant = await support.seedTenant("limit-usage")
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      const accounts = [tenant.accountId]
      const layer = ApplicationService.layerWith({ dailyApplyLimit: DEFAULT_DAILY_APPLY_LIMIT })
      const usage = () =>
        support.runAs(
          tenant.userId,
          Effect.gen(function*() {
            return yield* (yield* ApplicationService).dailyUsage(tenant.accountId)
          }).pipe(Effect.provide(layer), Effect.provideService(CurrentUser, { userId: tenant.userId as UserId }))
        )

      expect(DEFAULT_DAILY_APPLY_LIMIT).toBe(200)
      expect(await usage()).toMatchObject({ used: 0, limit: 200, remaining: 200, oldest: null })

      const a = await ready(tenant, tenant.accountId, harness, accounts, "usage-1")
      await approve(tenant.userId, a)
      const after = await usage()
      expect(after).toMatchObject({ used: 1, limit: 200, remaining: 199 })
      expect(after.oldest).not.toBeNull()
    }, 60_000)

    test("the account-level apply filter row sets the limit; a resume row does not", async () => {
      const tenant = await support.seedTenant("limit-override")
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      const accounts = [tenant.accountId]
      const a = await ready(tenant, tenant.accountId, harness, accounts, "override-1")
      const b = await ready(tenant, tenant.accountId, harness, accounts, "override-2")

      // The pinned layer says 2, the row says 1: the row wins.
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, dailyLimit: 1 })
      const usage = await support.runAs(
        tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* ApplicationService).dailyUsage(tenant.accountId)
        }).pipe(Effect.provide(limited), Effect.provideService(CurrentUser, { userId: tenant.userId as UserId }))
      )
      expect(usage).toMatchObject({ used: 0, limit: 1, remaining: 1 })

      expect((await approve(tenant.userId, a)).state).toBe("queued")
      const refused = await approveFailure(tenant.userId, b)
      expect(refused).toBeInstanceOf(LimitExceeded)
      expect((refused as LimitExceeded).limit).toBe(1)
      expect((refused as LimitExceeded).used).toBe(1)

      // Raising the row frees the slot immediately.
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, dailyLimit: 2 })
      expect((await approve(tenant.userId, b)).state).toBe("queued")
    }, 60_000)

    /** An auto-queued application with a stored kit for the fixture form, whose form is read now. */
    const autoQueuedReread = async (tenant: support.Tenant, label: string) => {
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      const vacancyId = await support.seedVacancy(label)
      const externalId = await support.vacancyExternalId(vacancyId)
      const applicationId = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        state: "queued"
      })
      const form = parseResponseForm(
        responseHtml,
        `https://hh.ru/applicant/vacancy_response?vacancyId=${externalId}`
      )
      await support.applicationSetKit(tenant.userId, {
        applicationId,
        formHash: form.formHash,
        letter: "Здравствуйте",
        answers: fullAnswers()
      })
      await support.enqueuePrepareJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        applicationId,
        vacancyId,
        externalId,
        sequence: 1
      })
      const leased = await support.leaseNext(tenant.userId, harness.id, harness.token!, [tenant.accountId])
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
      return applicationId
    }

    const intentAtOf = (applicationId: string) =>
      support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          const result = yield* database.asOwner((tx) =>
            tx.execute(sql`select intent_at, last_error from application where id = ${applicationId}`)
          )
          return result.rows[0] as unknown as { intent_at: Date | null; last_error: string | null }
        })
      )

    /** An application of the account that already holds a slot (approved a moment ago). */
    const occupySlot = async (tenant: support.Tenant, label: string) => {
      const id = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId: await support.seedVacancy(label),
        state: "queued"
      })
      await support.runAs(
        "owner",
        Effect.gen(function*() {
          const database = yield* Database
          yield* database.asOwner((tx) => tx.execute(sql`update application set intent_at = now() where id = ${id}`))
        })
      )
    }

    test("an auto-queued application whose form is re-read at the cap goes to needs_human", async () => {
      const tenant = await support.seedTenant("limit-auto-full")
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, dailyLimit: 1 })
      await occupySlot(tenant, "auto-full-held")

      const id = await autoQueuedReread(tenant, "auto-full")
      expect((await support.findApplication(id))?.state).toBe("needs_human")
      expect(await support.countJobs(id, "submit")).toBe(0)
      const row = await intentAtOf(id)
      expect(row.intent_at).toBeNull()
      expect(row.last_error).toContain("daily limit 1 reached")
    }, 60_000)

    test("an auto-queued application whose form is re-read with a free slot submits and stamps intent_at", async () => {
      const tenant = await support.seedTenant("limit-auto-free")
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, dailyLimit: 2 })
      await occupySlot(tenant, "auto-free-held")

      const id = await autoQueuedReread(tenant, "auto-free")
      expect((await support.findApplication(id))?.state).toBe("queued")
      expect(await support.countJobs(id, "submit")).toBe(1)
      expect((await intentAtOf(id)).intent_at).not.toBeNull()
    }, 60_000)

    test("usage of an unknown account is NotFound", async () => {
      const tenant = await support.seedTenant("limit-usage-404")
      const failure = await support.runAsFailure(
        tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* ApplicationService).dailyUsage("01a1acd9-0000-7000-8000-000000000000")
        }).pipe(Effect.provide(limited), Effect.provideService(CurrentUser, { userId: tenant.userId as UserId }))
      )
      expect(failure).toMatchObject({ _tag: "NotFound" })
    }, 60_000)
  })
}
