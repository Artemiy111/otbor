/**
 * Исправления по ревью preparing/раннера на настоящем Postgres: заявки руками
 * не бывают `preparing`, оператор не отправляет через сохранение кита, миграция
 * зависших `queued`, демотирование после любой записи apply filter, ожидание
 * `retry_at` у соседнего прохода, сбой чтения формы не затирает чужие ожидания,
 * сброс автоповторов и откат отклонённых операций.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "../../src/db/Database.ts"
import * as ApplicationRepository from "../../src/repositories/ApplicationRepository.ts"
import { ApplicationService } from "../../src/services/ApplicationService.ts"
import * as support from "./support/index.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

const responseHtml = readFileSync(join(import.meta.dir, "../../../hh/test/fixtures", "hh-test-response.html"), "utf8")

if (!enabled || serverUrl === null) {
  test("review-fixes integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
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

  const owner = <A>(run: (tx: Parameters<Parameters<Database["Service"]["asOwner"]>[0]>[0]) => Effect.Effect<A, any>) =>
    support.runAs(
      "owner",
      Effect.gen(function*() {
        const database = yield* Database
        return yield* database.asOwner((tx) => run(tx))
      })
    ) as Promise<A>

  interface Row {
    state: string
    auto_run: string | null
    intent_at: Date | null
    last_error: string | null
    blocked_reason: string | null
    retry_at: Date | null
    auto_retries: number
  }

  const rowOf = (id: string) =>
    owner((tx) =>
      tx
        .execute(
          sql`select state, auto_run, intent_at, last_error, blocked_reason, retry_at, auto_retries
              from application where id = ${id}`
        )
        .pipe(Effect.map((result) => result.rows[0] as unknown as Row))
    )

  /* ------------------------------------------------------------------------ */
  /* 2. Только раннер заводит preparing                                        */
  /* ------------------------------------------------------------------------ */

  describe("createFromDecision", () => {
    test("only the runner creates preparing; any other create is a draft without auto_run", async () => {
      const tenant = await support.seedTenant("rf-create")
      await support.seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "rf-create" })
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, autoMode: "off" })
      const decide = async (label: string) => {
        const vacancyId = await support.seedVacancyTitled(label, `DevOps engineer ${label}`, { salaryFrom: 300_000 })
        const decision = await support.evaluateVacancy(tenant.userId, {
          vacancyId,
          hhAccountId: tenant.accountId,
          fit: 90
        })
        expect(decision.verdict).toBe("apply")
        return decision.id
      }
      const create = (input: Parameters<ApplicationService["Service"]["createFromDecision"]>[0]) =>
        support.runAs(
          tenant.userId,
          Effect.gen(function*() {
            return yield* (yield* ApplicationService).createFromDecision(input)
          })
        )

      const byHand = await create({ decisionId: await decide("rf-create-1"), hhAccountId: tenant.accountId, mode: "auto" })
      expect(byHand.state).toBe("draft")
      expect(await rowOf(byHand.id)).toMatchObject({ state: "draft", auto_run: null })

      const owned = await create({
        decisionId: await decide("rf-create-2"),
        hhAccountId: tenant.accountId,
        mode: "auto",
        autoRun: true
      })
      expect(await rowOf(owned.id)).toMatchObject({ state: "preparing", auto_run: "auto" })

      const drafts = await create({
        decisionId: await decide("rf-create-3"),
        hhAccountId: tenant.accountId,
        mode: "drafts",
        autoRun: true
      })
      expect(await rowOf(drafts.id)).toMatchObject({ state: "draft", auto_run: "drafts" })
    }, 60_000)
  })

  /* ------------------------------------------------------------------------ */
  /* 3. Миграция зависших queued                                               */
  /* ------------------------------------------------------------------------ */

  describe("migration 0047", () => {
    test("moves queued applications without a slot and a submit job to draft, keeps the rest", async () => {
      const tenant = await support.seedTenant("rf-mig")
      const statement = readFileSync(
        join(import.meta.dir, "../../migrations/0047_stuck_queued_to_draft.sql"),
        "utf8"
      )
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
      const make = async (label: string, input: { autoRun?: "auto" | "drafts"; intentAt?: Date }) =>
        support.seedApplication({
          userId: tenant.userId,
          accountId: tenant.accountId,
          vacancyId: await support.seedVacancy(label),
          state: "queued",
          ...(input.autoRun === undefined ? {} : { autoRun: input.autoRun }),
          ...(input.intentAt === undefined ? {} : { intentAt: input.intentAt })
        })
      const manual = await make("rf-mig-manual", {})
      const drafts = await make("rf-mig-drafts", { autoRun: "drafts" })
      const auto = await make("rf-mig-auto", { autoRun: "auto" })
      const holding = await make("rf-mig-holding", { intentAt: new Date() })
      const withJob = await make("rf-mig-job", {})
      await support.enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        applicationId: withJob,
        stage: "submit"
      })
      await owner((tx) =>
        tx.execute(sql`update application set blocked_reason = 'operator' where id = ${manual}`)
      )

      await owner((tx) => tx.execute(sql.raw(statement)))

      expect(await rowOf(manual)).toMatchObject({ state: "draft", blocked_reason: null })
      expect((await rowOf(manual)).last_error).toContain("stuck in the queue")
      expect((await rowOf(drafts)).state).toBe("draft")
      expect((await rowOf(auto)).state).toBe("queued")
      expect((await rowOf(holding)).state).toBe("queued")
      expect((await rowOf(withJob)).state).toBe("queued")
    }, 60_000)
  })

  /* ------------------------------------------------------------------------ */
  /* 4. Демотирование после любой записи apply filter                          */
  /* ------------------------------------------------------------------------ */

  describe("apply filter writes", () => {
    test("fromPreset that adds an off pair row demotes the auto applications it now governs", async () => {
      const tenant = await support.seedTenant("rf-preset")
      const resumeId = await support.seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "rf-preset" })
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, autoMode: "auto" })
      const id = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId: await support.seedVacancy("rf-preset"),
        state: "preparing",
        autoRun: "auto",
        resumeId
      })
      const slots = () =>
        owner((tx) => ApplicationRepository.pendingAutoSlots(tx, tenant.userId, tenant.accountId))
      expect(await slots()).toBe(1)

      const presetId = await support.seedPreset(tenant.userId, { kind: "apply", title: "rf-preset", filter: {} })
      await support.applyFilterFromPreset(tenant.userId, {
        hhAccountId: tenant.accountId,
        resumeId,
        presetId
      } as never)

      expect(await rowOf(id)).toMatchObject({ state: "draft", blocked_reason: null, retry_at: null })
      expect(await slots()).toBe(0)
    }, 60_000)

    test("pendingAutoSlots counts only applications whose governing row is auto", async () => {
      const tenant = await support.seedTenant("rf-slots")
      await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId: await support.seedVacancy("rf-slots"),
        state: "preparing",
        autoRun: "auto"
      })
      const slots = () =>
        owner((tx) => ApplicationRepository.pendingAutoSlots(tx, tenant.userId, tenant.accountId))
      expect(await slots()).toBe(0)
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, autoMode: "auto" })
      expect(await slots()).toBe(1)
    }, 60_000)
  })

  /* ------------------------------------------------------------------------ */
  /* 5. Ожидание retry_at                                                      */
  /* ------------------------------------------------------------------------ */

  describe("retry wait", () => {
    test("clearPreparingBlock clears only a block whose time has come", async () => {
      const tenant = await support.seedTenant("rf-clear")
      const id = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId: await support.seedVacancy("rf-clear"),
        state: "preparing",
        autoRun: "auto"
      })
      await owner((tx) =>
        tx.execute(sql`update application set blocked_reason = 'daily_cap', retry_at = now() + interval '5 hours' where id = ${id}`)
      )
      const clear = () => owner((tx) => ApplicationRepository.clearPreparingBlock(tx, tenant.userId, id))
      const due = () => owner((tx) => ApplicationRepository.retryDue(tx, id))

      expect(await due()).toBe(false)
      expect(await clear()).toBe(false)
      expect(await rowOf(id)).toMatchObject({ blocked_reason: "daily_cap" })

      await owner((tx) => tx.execute(sql`update application set retry_at = now() - interval '1 minute' where id = ${id}`))
      expect(await due()).toBe(true)
      expect(await clear()).toBe(true)
      expect(await rowOf(id)).toMatchObject({ blocked_reason: null, retry_at: null })
    }, 60_000)
  })

  /* ------------------------------------------------------------------------ */
  /* 6. Сбой чтения формы и автоповторы                                        */
  /* ------------------------------------------------------------------------ */

  describe("form read and the retry budget", () => {
    test("a failed read keeps other waits; a successful read frees form_read_failed and resets the budget", async () => {
      const tenant = await support.seedTenant("rf-read")
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      const vacancyId = await support.seedVacancy("rf-read")
      const externalId = await support.vacancyExternalId(vacancyId)
      const capped = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        state: "preparing",
        autoRun: "auto",
        resumeId: await support.seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "rf-read-a" })
      })
      const plain = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        state: "preparing",
        autoRun: "auto",
        resumeId: await support.seedResume({ userId: tenant.userId, accountId: tenant.accountId, title: "rf-read-b" })
      })
      await owner((tx) =>
        tx.execute(sql`update application
          set blocked_reason = 'daily_cap', retry_at = now() + interval '5 hours', auto_retries = 1
          where id = ${capped}`)
      )
      const before = await rowOf(capped)

      // Харнесс сдаётся на всех попытках чтения.
      await support.enqueuePrepareJob({ userId: tenant.userId, accountId: tenant.accountId, vacancyId, externalId })
      for (let attempt = 0; attempt < 6; attempt++) {
        const leased = await support.leaseNext(tenant.userId, harness.id, harness.token!, [tenant.accountId])
        if (leased.job === null || leased.job === undefined) break
        await support.completeJob(tenant.userId, {
          harnessId: harness.id,
          token: harness.token!,
          jobId: leased.job.id,
          leaseId: leased.job.leaseId!,
          epoch: leased.job.leaseEpoch,
          exit: { tag: "internal_error", message: "navigation timeout" } as never
        })
        await owner((tx) => tx.execute(sql`update harness_jobs set run_at = now() where stage = 'form_read'`))
      }

      const afterFail = await rowOf(capped)
      expect(afterFail.blocked_reason).toBe("daily_cap")
      expect(afterFail.auto_retries).toBe(1)
      expect(afterFail.retry_at?.getTime()).toBe(before.retry_at?.getTime())
      expect(afterFail.last_error).toBe(before.last_error)
      expect(await rowOf(plain)).toMatchObject({ state: "preparing", blocked_reason: "form_read_failed", auto_retries: 1 })

      // Чтение удалось: ожидание form_read_failed снято, бюджет начат заново; чужое не тронуто.
      await support.enqueuePrepareJob({ userId: tenant.userId, accountId: tenant.accountId, vacancyId, externalId })
      const leased = await support.leaseNext(tenant.userId, harness.id, harness.token!, [tenant.accountId])
      expect(leased.job?.stage).toBe("form_read")
      await support.completeJob(tenant.userId, {
        harnessId: harness.id,
        token: harness.token!,
        jobId: leased.job!.id,
        leaseId: leased.job!.leaseId!,
        epoch: leased.job!.leaseEpoch,
        exit: {
          tag: "prepared",
          artifacts: { url: `https://hh.ru/applicant/vacancy_response?vacancyId=${externalId}`, html: responseHtml }
        }
      })
      expect(await rowOf(plain)).toMatchObject({ state: "preparing", blocked_reason: null, retry_at: null, auto_retries: 0 })
      expect(await rowOf(capped)).toMatchObject({ blocked_reason: "daily_cap", auto_retries: 1 })
    }, 60_000)

    test("storing a kit resets the auto-retry budget", async () => {
      const tenant = await support.seedTenant("rf-kit")
      const id = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId: await support.seedVacancy("rf-kit"),
        state: "preparing",
        autoRun: "auto"
      })
      await owner((tx) => tx.execute(sql`update application set auto_retries = 2 where id = ${id}`))
      await support.applicationSetKit(tenant.userId, { applicationId: id, formHash: "h", letter: "x", answers: [] })
      expect((await rowOf(id)).auto_retries).toBe(0)
    }, 60_000)
  })

  /* ------------------------------------------------------------------------ */
  /* 7. Отказ откатывает записи                                                */
  /* ------------------------------------------------------------------------ */

  describe("refused operations", () => {
    test("retry of a queued application is refused without cancelling its submit job", async () => {
      const tenant = await support.seedTenant("rf-rollback")
      const vacancyId = await support.seedVacancy("rf-rollback")
      const id = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        state: "queued",
        intentAt: new Date()
      })
      await support.enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, applicationId: id, stage: "submit" })

      const error = await support.runAsFailure(
        tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* ApplicationService).retry(id)
        })
      )
      expect((error as { _tag: string })._tag).toBe("Conflict")

      const jobs = await support.jobsOf(id)
      expect(jobs).toHaveLength(1)
      expect(jobs[0]).toMatchObject({ stage: "submit", status: "pending" })
      expect(await support.countJobs(id, "reconcile")).toBe(0)
      expect((await rowOf(id)).state).toBe("queued")
    }, 60_000)
  })
}
