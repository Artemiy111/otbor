/** Integration: queue-search. See README.md for how to run. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { QueueService } from "../../src/services/QueueService.ts"
import {
  addAccount,
  createTestDatabase,
  dropTestDatabase,
  enqueueInference,
  enqueueJob,
  integrationEnabled,
  migrateTestDatabase,
  ownerTx,
  runAs,
  seedApplication,
  seedTenant,
  seedVacancyForEmployer,
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

  const search = (userId: string, options: Parameters<QueueService["Service"]["search"]>[0] = {}) =>
    runAs(
      userId,
      Effect.gen(function*() {
        const queue = yield* QueueService
        return yield* queue.search(options)
      })
    )

  const stats = (userId: string) =>
    runAs(
      userId,
      Effect.gen(function*() {
        const queue = yield* QueueService
        return yield* queue.stats()
      })
    )

  const patchJob = (jobId: string, set: ReturnType<typeof sql>) =>
    runAs("owner", ownerTx((tx) => tx.execute(sql`update harness_jobs set ${set} where id = ${jobId}`)))

  describe("QueueJobsSearch", () => {
    test("отдаёт аккаунт, вакансию, отклик и ошибку задачи без разбора payload", async () => {
      const tenant = await seedTenant("qs-fields")
      const vacancy = await seedVacancyForEmployer({
        label: "qs-fields",
        title: "Rust разработчик qs",
        employerExternalId: "emp-qs-fields",
        employerName: "Co qs"
      })
      const applicationId = await seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId: vacancy.vacancyId,
        state: "queued"
      })
      const prepare = await enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        applicationId,
        stage: "prepare"
      })
      // Чтение формы идёт без отклика: вакансия лежит только в payload.
      const formRead = await enqueueJob({
        userId: tenant.userId,
        accountId: tenant.accountId,
        stage: "form_read",
        payload: { vacancyId: vacancy.vacancyId }
      })
      const inference = await enqueueInference(tenant.userId, { prompt: "hi" })
      await patchJob(prepare.id, sql`status = 'failed', last_error = 'hh вернул 500'`)

      const { items, total } = await search(tenant.userId)
      expect(total).toBe(3)
      const byId = new Map(items.map((item) => [item.id, item]))

      expect(byId.get(prepare.id)).toMatchObject({
        hhAccountId: tenant.accountId,
        accountName: "qs-fields",
        vacancyId: vacancy.vacancyId,
        vacancyTitle: "Rust разработчик qs",
        applicationId,
        lastError: "hh вернул 500",
        status: "failed"
      })
      expect(byId.get(formRead.id)).toMatchObject({
        hhAccountId: tenant.accountId,
        vacancyId: vacancy.vacancyId,
        vacancyTitle: "Rust разработчик qs",
        applicationId: null,
        lastError: null
      })
      // Генерация привязана к аккаунту по умолчанию, но вакансии и отклика у неё нет.
      expect(byId.get(inference.job.id)).toMatchObject({
        hhAccountId: tenant.accountId,
        accountName: "qs-fields",
        vacancyId: null,
        applicationId: null,
        lastError: null
      })
    })

    test("страницы, несколько статусов и стадий, поиск, считает total без страницы", async () => {
      const tenant = await seedTenant("qs-filters")
      const second = await addAccount(tenant.userId, "second")
      const ids: string[] = []
      for (const stage of ["prepare", "submit", "reconcile", "form_read", "session"] as const) {
        ids.push(
          (await enqueueJob({ userId: tenant.userId, accountId: stage === "session" ? second : tenant.accountId, stage }))
            .id
        )
      }
      await patchJob(ids[0]!, sql`status = 'done'`)
      await patchJob(ids[1]!, sql`status = 'needs_human', last_error = 'нужен человек'`)
      await patchJob(ids[2]!, sql`status = 'needs_reconcile'`)

      const page = await search(tenant.userId, { limit: 2, offset: 0 })
      expect(page.total).toBe(5)
      expect(page.items).toHaveLength(2)
      const next = await search(tenant.userId, { limit: 2, offset: 2 })
      expect(next.items).toHaveLength(2)
      const last = await search(tenant.userId, { limit: 2, offset: 4 })
      expect(last.items).toHaveLength(1)
      expect(new Set([...page.items, ...next.items, ...last.items].map((i) => i.id)).size).toBe(5)

      const stuck = await search(tenant.userId, { status: ["needs_human", "needs_reconcile"] })
      expect(stuck.total).toBe(2)
      expect(stuck.items.map((i) => i.stage).sort()).toEqual(["reconcile", "submit"])

      const stages = await search(tenant.userId, { stage: ["prepare", "session"] })
      expect(stages.total).toBe(2)
      expect(stages.items.find((i) => i.stage === "session")!.accountName).toBe("second")

      const both = await search(tenant.userId, { status: ["pending"], stage: ["prepare", "form_read"] })
      expect(both.items.map((i) => i.stage)).toEqual(["form_read"])

      const query = await search(tenant.userId, { query: "человек" })
      expect(query.items.map((i) => i.id)).toEqual([ids[1]!] as never)
      const byAccount = await search(tenant.userId, { query: "second" })
      expect(byAccount.total).toBe(1)
      // Подстановочные знаки в поиске не работают как шаблон.
      expect((await search(tenant.userId, { query: "%" })).total).toBe(0)
    })

    test("не показывает задачи другого пользователя", async () => {
      const mine = await seedTenant("qs-mine")
      const other = await seedTenant("qs-other")
      await enqueueJob({ userId: other.userId, accountId: other.accountId, stage: "prepare" })
      expect((await search(mine.userId)).total).toBe(0)
      expect((await search(other.userId)).total).toBe(1)
    })
  })

  describe("QueueStatsGet", () => {
    test("needsHuman и needsReconcile без окна по времени, done/failed/dead за сутки", async () => {
      const tenant = await seedTenant("qs-stats")
      const old = sql`created_at = now() - interval '10 days'`
      const human = await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "submit" })
      const reconcile = await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "reconcile" })
      const done = await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "prepare" })
      const failed = await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "form_read" })
      const fresh = await enqueueJob({ userId: tenant.userId, accountId: tenant.accountId, stage: "session" })
      await patchJob(human.id, sql`status = 'needs_human', created_at = now() - interval '10 days'`)
      await patchJob(reconcile.id, sql`status = 'needs_reconcile', created_at = now() - interval '10 days'`)
      await patchJob(done.id, sql`status = 'done', ${old}`)
      await patchJob(failed.id, sql`status = 'failed', ${old}`)
      await patchJob(fresh.id, sql`status = 'failed'`)

      const view = await stats(tenant.userId)
      expect(view.needsHuman).toBe(1)
      expect(view.needsReconcile).toBe(1)
      // Старые done и failed вышли из суточного окна, свежий failed остался.
      expect(view.done).toBe(0)
      expect(view.failed).toBe(1)
      expect(view.dead).toBe(0)
      // Возраст считается по ожидающим, а не по старым застрявшим задачам.
      expect(view.pending).toBe(0)
      expect(view.oldestPendingAgeSeconds).toBe(0)
    })

    test("счётчики не видят чужие задачи", async () => {
      const mine = await seedTenant("qs-stats-mine")
      const other = await seedTenant("qs-stats-other")
      const job = await enqueueJob({ userId: other.userId, accountId: other.accountId, stage: "submit" })
      await patchJob(job.id, sql`status = 'needs_human'`)
      expect((await stats(mine.userId)).needsHuman).toBe(0)
      expect((await stats(other.userId)).needsHuman).toBe(1)
    })
  })
}
