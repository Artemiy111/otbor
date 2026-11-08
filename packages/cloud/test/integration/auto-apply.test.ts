/**
 * AutoApplyRunner against a real Postgres: the `apply` schedule kind turns an
 * apply filter's `auto_mode` into applications, writing jobs and kits. The
 * harness is faked (the test leases and completes the browser and inference
 * jobs itself); pages are the local fixtures of packages/hh. Nothing reaches hh.ru.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { ApplyFilterRecord } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "../../src/db/Database.ts"
import { AutoApplyRunner } from "../../src/services/AutoApplyRunner.ts"
import { AutoApplyViewService } from "../../src/services/AutoApplyViewService.ts"
import { ResumeService } from "../../src/services/ResumeService.ts"
import * as support from "./support/index.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "../../../hh/test/fixtures", name), "utf8")
const responseHtml = fixture("hh-test-response.html")

/** A complete model answer for hh-test-response.html. */
const GOOD_DRAFT = JSON.stringify({
  letter: "Здравствуйте. Работаю с Kubernetes и Terraform, поддерживаю кластеры в продакшене.",
  answers: [
    { questionId: "387049547", optionIds: ["387049548"] },
    { questionId: "387049551", optionIds: ["387049553"] },
    { questionId: "387049555", text: "Москва" },
    { questionId: "387049556", optionIds: ["387049558"] },
    { questionId: "387049560", text: "300000 рублей" }
  ]
})

/** The same, without the required salary answer: checkKit must refuse it. */
const INCOMPLETE_DRAFT = JSON.stringify({
  letter: "Здравствуйте. Работаю с Kubernetes и Terraform.",
  answers: [{ questionId: "387049547", optionIds: ["387049548"] }]
})

if (!enabled || serverUrl === null) {
  test("auto-apply integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
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

  /* ------------------------------------------------------------------------ */
  /* Helpers                                                                  */
  /* ------------------------------------------------------------------------ */

  const tick = (userId: string, options: { hhAccountId?: string } = {}) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        return yield* (yield* AutoApplyRunner).run(userId, options)
      })
    )

  const owner = <A>(run: (tx: Parameters<Parameters<Database["Service"]["asOwner"]>[0]>[0]) => Effect.Effect<A, any>) =>
    support.runAs(
      "owner",
      Effect.gen(function*() {
        const database = yield* Database
        return yield* database.asOwner((tx) => run(tx))
      })
    ) as Promise<A>

  const applicationsOf = (accountId: string) =>
    owner((tx) =>
      tx
        .execute(
          sql`select id, vacancy_id, state, auto_run, intent_at, last_error, blocked_reason, retry_at, auto_retries from application where hh_account_id = ${accountId} order by created_at, id`
        )
        .pipe(
          Effect.map(
            (result) =>
              result.rows as unknown as ReadonlyArray<{
                id: string
                vacancy_id: string
                state: string
                auto_run: string | null
                intent_at: Date | null
                last_error: string | null
                blocked_reason: string | null
                retry_at: Date | null
                auto_retries: number
              }>
          )
        )
    )

  /** Writing jobs of one hh account (the database is shared by every test). */
  const writingJobs = (accountId: string) =>
    owner((tx) =>
      tx
        .execute(
          sql`select id, status, idempotency_key from harness_jobs
              where stage = 'inference' and hh_account_id = ${accountId}
                and idempotency_key like 'autoapply:writing:%'
              order by created_at`
        )
        .pipe(Effect.map((result) => result.rows as unknown as ReadonlyArray<{ id: string; status: string }>))
    )

  const submitCount = (applicationId: string) => support.countJobs(applicationId, "submit")

  const kitOf = (applicationId: string) =>
    owner((tx) =>
      tx
        .execute(sql`select letter, answers, model from application_kit where application_id = ${applicationId}`)
        .pipe(
          Effect.map(
            (result) =>
              (result.rows as unknown as ReadonlyArray<{ letter: string | null; answers: unknown[]; model: string | null }>)[0] ??
              null
          )
        )
    )

  /** One tenant, one account, a harness that runs both browser and inference jobs. */
  const setup = async (label: string, options: { row?: boolean } = {}) => {
    const tenant = await support.seedTenant(label)
    const harness = await support.registerHarness(tenant.userId, [tenant.accountId], `harness-${label}`, [
      "browser",
      "inference"
    ])
    await createResume(tenant.userId, tenant.accountId, `aa-resume-${label}`)
    // The row exists (off) before any decision is made: editing its mode later
    // does not change scoring, so the decisions stay current.
    if (options.row !== false) {
      await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, autoMode: "off" })
    }
    return { tenant, harness, accounts: [tenant.accountId] }
  }
  type Ctx = Awaited<ReturnType<typeof setup>>

  /** Sets the account row (open filter) with the given settings. */
  const configure = (
    ctx: Ctx,
    settings: Partial<{
      autoMode: ApplyFilterRecord["autoMode"]
      batchSize: number
      sort: ApplyFilterRecord["sort"]
      sortDirection: ApplyFilterRecord["sortDirection"]
      minPriority: number
      dailyLimit: number
    }>,
    resumeId?: string
  ) =>
    support.applyFilterSet(ctx.tenant.userId, {
      hhAccountId: ctx.tenant.accountId,
      ...(resumeId === undefined ? {} : { resumeId }),
      filter: {},
      ...settings
    })

  /** A vacancy with an `apply` decision of the given fit (priority = fit / 2: no publish date). */
  const decided = async (
    ctx: Ctx,
    label: string,
    fit: number,
    options: { salaryFrom?: number; resumeId?: string } = {}
  ) => {
    const vacancyId = await support.seedVacancyTitled(label, `DevOps engineer ${label}`, {
      salaryFrom: options.salaryFrom ?? 300_000
    })
    const decision = await support.evaluateVacancy(ctx.tenant.userId, {
      vacancyId,
      hhAccountId: ctx.tenant.accountId,
      fit,
      ...(options.resumeId === undefined ? {} : { resumeId: options.resumeId })
    })
    expect(decision.verdict).toBe("apply")
    return { vacancyId, decision }
  }

  /** Leases the next job of a kind as the fake harness and completes it. */
  const leaseAndComplete = async (
    ctx: Ctx,
    kind: "browser" | "inference",
    exit: Parameters<typeof support.completeJob>[1]["exit"] | ((job: { stage: string; payload: any }) => Parameters<typeof support.completeJob>[1]["exit"])
  ) => {
    const leased = await support.leaseNext(ctx.tenant.userId, ctx.harness.id, ctx.harness.token!, ctx.accounts, [kind])
    const job = leased.job
    if (job === null || job === undefined) return null
    await support.completeJob(ctx.tenant.userId, {
      harnessId: ctx.harness.id,
      token: ctx.harness.token!,
      jobId: job.id,
      leaseId: job.leaseId!,
      epoch: job.leaseEpoch,
      exit: typeof exit === "function" ? exit(job as never) : exit
    })
    return job
  }

  /** Answers every queued form read with the given page. */
  const readForms = async (ctx: Ctx, html: string) => {
    let count = 0
    for (;;) {
      const job = await leaseAndComplete(ctx, "browser", (leased) => ({
        tag: "prepared",
        artifacts: {
          url: `https://hh.ru/applicant/vacancy_response?vacancyId=${leased.payload.externalId}`,
          html
        }
      }))
      if (job === null) return count
      expect(job.stage).toBe("form_read")
      count += 1
    }
  }

  /** Answers every queued writing job with the given model text. */
  const writeLetters = async (ctx: Ctx, text: string) => {
    let count = 0
    for (;;) {
      const job = await leaseAndComplete(ctx, "inference", {
        tag: "prepared",
        artifacts: { text, model: "test/model" }
      })
      if (job === null) return count
      count += 1
    }
  }

  const createResume = (userId: string, hhAccountId: string, externalId: string) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        return yield* (yield* ResumeService).upsert({
          hhAccountId: hhAccountId as never,
          source: "hh",
          externalId,
          title: externalId,
          text: `Resume ${externalId}: DevOps, Kubernetes, Terraform`,
          about: "",
          skills: [],
          experience: [],
          education: [],
          workFormats: [],
          isActive: true
        })
      })
    )

  const zero = {
    accounts: 0,
    selected: 0,
    created: 0,
    writingEnqueued: 0,
    kitsSet: 0,
    submitQueued: 0,
    needsHuman: 0,
    waiting: 0
  }

  /* ------------------------------------------------------------------------ */
  /* Off                                                                      */
  /* ------------------------------------------------------------------------ */

  describe("auto mode off", () => {
    test("with no row or an off row nothing is read, created or queued", async () => {
      const ctx = await setup("aa-off", { row: false })
      const { vacancyId } = await decided(ctx, "aa-off-1", 90)

      expect(await tick(ctx.tenant.userId)).toMatchObject(zero)
      await configure(ctx, { autoMode: "off" })
      expect(await tick(ctx.tenant.userId)).toMatchObject(zero)

      expect(await applicationsOf(ctx.tenant.accountId)).toHaveLength(0)
      expect(await support.formReadJobsOf(vacancyId)).toHaveLength(0)
      expect(await writingJobs(ctx.tenant.accountId)).toHaveLength(0)
    }, 60_000)

    test("an application of the runner stops moving when its row is switched off", async () => {
      const ctx = await setup("aa-off-later")
      await configure(ctx, { autoMode: "drafts" })
      await decided(ctx, "aa-off-later-1", 90)
      expect((await tick(ctx.tenant.userId)).created).toBe(1)
      await readForms(ctx, responseHtml)

      await configure(ctx, { autoMode: "off" })
      expect(await tick(ctx.tenant.userId)).toMatchObject(zero)
      expect(await writingJobs(ctx.tenant.accountId)).toHaveLength(0)
    }, 60_000)
  })

  /* ------------------------------------------------------------------------ */
  /* Drafts                                                                   */
  /* ------------------------------------------------------------------------ */

  describe("drafts mode", () => {
    test("creates applications, writes letters, stores kits and never submits; a second tick is a no-op", async () => {
      const ctx = await setup("aa-drafts")
      await configure(ctx, { autoMode: "drafts" })
      const a = await decided(ctx, "aa-drafts-a", 90)
      const b = await decided(ctx, "aa-drafts-b", 80)

      // 1. selection and creation; the form reads are queued by createFromDecision
      const first = await tick(ctx.tenant.userId)
      expect(first).toMatchObject({ accounts: 1, selected: 2, created: 2, writingEnqueued: 0, kitsSet: 0 })
      const created = await applicationsOf(ctx.tenant.accountId)
      expect(created.map((row) => [row.state, row.auto_run])).toEqual([
        ["draft", "drafts"],
        ["draft", "drafts"]
      ])
      expect(await support.formReadJobsOf(a.vacancyId)).toHaveLength(1)

      // 2. the forms are still unread: nothing is written, nothing created twice
      expect(await tick(ctx.tenant.userId)).toMatchObject({ selected: 0, created: 0, writingEnqueued: 0, waiting: 2 })

      // 3. forms read: one writing job per application
      expect(await readForms(ctx, responseHtml)).toBe(2)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ created: 0, writingEnqueued: 2, kitsSet: 0 })
      expect(await writingJobs(ctx.tenant.accountId)).toHaveLength(2)

      // 4. jobs not done yet: idempotent, no second job
      expect(await tick(ctx.tenant.userId)).toMatchObject({ writingEnqueued: 0, waiting: 2, kitsSet: 0 })
      expect(await writingJobs(ctx.tenant.accountId)).toHaveLength(2)

      // 5. the fake harness answers; the kits are stored
      expect(await writeLetters(ctx, GOOD_DRAFT)).toBe(2)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ writingEnqueued: 0, kitsSet: 2, needsHuman: 0, submitQueued: 0 })

      for (const row of await applicationsOf(ctx.tenant.accountId)) {
        expect(row.state).toBe("draft")
        expect(row.intent_at).toBeNull()
        expect(await submitCount(row.id)).toBe(0)
        const kit = await kitOf(row.id)
        // the fixture form takes no cover letter, so none is stored
        expect(kit?.letter ?? null).toBeNull()
        expect(kit?.model).toBe("test/model")
        expect(kit?.answers.length).toBeGreaterThanOrEqual(5)
      }

      // 6. nothing is left to do
      expect(await tick(ctx.tenant.userId)).toMatchObject({
        selected: 0,
        created: 0,
        writingEnqueued: 0,
        kitsSet: 0,
        needsHuman: 0
      })
      expect(await writingJobs(ctx.tenant.accountId)).toHaveLength(2)
      expect(b.vacancyId).not.toBe(a.vacancyId)
    }, 120_000)

    test("a dead writing job parks the application for a human", async () => {
      const ctx = await setup("aa-drafts-dead")
      await configure(ctx, { autoMode: "drafts" })
      await decided(ctx, "aa-drafts-dead-1", 90)
      await tick(ctx.tenant.userId)
      await readForms(ctx, responseHtml)
      await tick(ctx.tenant.userId)

      // the harness fails every attempt of the job
      for (let attempt = 0; attempt < 3; attempt++) {
        await leaseAndComplete(ctx, "inference", { tag: "inference_failed", message: "agent exited 1" })
        await owner((tx) => tx.execute(sql`update harness_jobs set run_at = now() where stage = 'inference'`))
      }
      const [job] = await writingJobs(ctx.tenant.accountId)
      expect(["failed", "dead"]).toContain(job!.status)

      const result = await tick(ctx.tenant.userId)
      expect(result).toMatchObject({ needsHuman: 1, kitsSet: 0 })
      const [row] = await applicationsOf(ctx.tenant.accountId)
      expect(row!.state).toBe("needs_human")
      expect(row!.last_error).toContain("writing job")
      // The harness message is not lost: the person sees WHY.
      expect(row!.last_error).toContain("inference exhausted retries: inference_failed: agent exited 1")
      const [stored] = await owner((tx) =>
        tx
          .execute(sql`select last_error from harness_jobs where stage = 'inference' and hh_account_id = ${ctx.tenant.accountId}`)
          .pipe(Effect.map((result) => result.rows as unknown as ReadonlyArray<{ last_error: string }>))
      )
      expect(stored!.last_error).toBe("inference exhausted retries: inference_failed: agent exited 1")
    }, 60_000)

    test("the writing job carries the operator's agent, model and effort; unset means an empty payload tail", async () => {
      const ctx = await setup("aa-drafts-writer")
      await support.applyFilterSet(ctx.tenant.userId, {
        hhAccountId: ctx.tenant.accountId,
        filter: {},
        autoMode: "drafts",
        writingHarness: "claude",
        writingModel: "haiku",
        writingEffort: "low"
      })
      await decided(ctx, "aa-drafts-writer-1", 90)
      await tick(ctx.tenant.userId)
      await readForms(ctx, responseHtml)
      await tick(ctx.tenant.userId)
      const [job] = await owner((tx) =>
        tx
          .execute(sql`select payload from harness_jobs where stage = 'inference' and hh_account_id = ${ctx.tenant.accountId}`)
          .pipe(Effect.map((result) => result.rows as unknown as ReadonlyArray<{ payload: Record<string, unknown> }>))
      )
      expect(job!.payload).toMatchObject({ harness: "claude", model: "haiku", effort: "low" })
      expect(typeof job!.payload.prompt).toBe("string")

      // Cleared settings: the harness default (no keys at all).
      const other = await setup("aa-drafts-writer-none")
      await configure(other, { autoMode: "drafts" })
      await decided(other, "aa-drafts-writer-2", 90)
      await tick(other.tenant.userId)
      await readForms(other, responseHtml)
      await tick(other.tenant.userId)
      const [plain] = await owner((tx) =>
        tx
          .execute(sql`select payload from harness_jobs where stage = 'inference' and hh_account_id = ${other.tenant.accountId}`)
          .pipe(Effect.map((result) => result.rows as unknown as ReadonlyArray<{ payload: Record<string, unknown> }>))
      )
      expect(plain!.payload.harness).toBeUndefined()
      expect(plain!.payload.model).toBeUndefined()
      expect(plain!.payload.effort).toBeUndefined()
    }, 120_000)
  })

  /* ------------------------------------------------------------------------ */
  /* Auto                                                                     */
  /* ------------------------------------------------------------------------ */

  describe("auto mode", () => {
    test("submits exactly once when the kit passes, and parks a kit that does not", async () => {
      const ctx = await setup("aa-auto")
      await configure(ctx, { autoMode: "auto" })
      const good = await decided(ctx, "aa-auto-good", 90)
      const bad = await decided(ctx, "aa-auto-bad", 80)

      expect(await tick(ctx.tenant.userId)).toMatchObject({ created: 2 })
      const queued = await applicationsOf(ctx.tenant.accountId)
      expect(queued.map((row) => [row.state, row.auto_run])).toEqual([
        ["preparing", "auto"],
        ["preparing", "auto"]
      ])
      // nothing goes out before the kit exists
      for (const row of queued) expect(await submitCount(row.id)).toBe(0)

      await readForms(ctx, responseHtml)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ writingEnqueued: 2 })

      // the first job (higher priority) is answered well, the second incompletely
      const answers = [GOOD_DRAFT, INCOMPLETE_DRAFT]
      for (const text of answers) {
        await leaseAndComplete(ctx, "inference", { tag: "prepared", artifacts: { text, model: "test/model" } })
      }
      const outcome = await tick(ctx.tenant.userId)
      expect(outcome).toMatchObject({ kitsSet: 1, submitQueued: 1, needsHuman: 1 })

      const byVacancy = new Map((await applicationsOf(ctx.tenant.accountId)).map((row) => [row.vacancy_id, row]))
      const sent = byVacancy.get(good.vacancyId)!
      const parked = byVacancy.get(bad.vacancyId)!
      expect(sent.state).toBe("queued")
      expect(sent.intent_at).not.toBeNull()
      expect(await submitCount(sent.id)).toBe(1)
      expect(parked.state).toBe("needs_human")
      expect(parked.last_error).toContain("kit refused")
      expect(await submitCount(parked.id)).toBe(0)

      // a further tick neither queues a second submit nor touches the parked one
      expect(await tick(ctx.tenant.userId)).toMatchObject({ kitsSet: 0, submitQueued: 0, needsHuman: 0, writingEnqueued: 0 })
      expect(await submitCount(sent.id)).toBe(1)
      expect(await submitCount(parked.id)).toBe(0)
    }, 120_000)

    test("the daily budget bounds new applications; the cap itself stays in ApplicationService", async () => {
      const ctx = await setup("aa-budget")
      await configure(ctx, { autoMode: "auto", dailyLimit: 1, batchSize: 10 })
      await decided(ctx, "aa-budget-1", 90)
      await decided(ctx, "aa-budget-2", 80)
      await decided(ctx, "aa-budget-3", 70)

      // one slot: one application
      expect(await tick(ctx.tenant.userId)).toMatchObject({ selected: 1, created: 1 })
      // the slot is spoken for by the queued application, so nothing more is created
      expect(await tick(ctx.tenant.userId)).toMatchObject({ selected: 0, created: 0 })
      expect(await applicationsOf(ctx.tenant.accountId)).toHaveLength(1)
    }, 60_000)
  })

  /* ------------------------------------------------------------------------ */
  /* Selection                                                                */
  /* ------------------------------------------------------------------------ */

  describe("selection", () => {
    const vacancyOrder = async (ctx: Ctx) =>
      (await applicationsOf(ctx.tenant.accountId)).map((row) => row.vacancy_id)

    test("batch_size bounds a tick and the next tick takes the next best", async () => {
      const ctx = await setup("aa-batch")
      await configure(ctx, { autoMode: "drafts", batchSize: 2 })
      const v = [
        await decided(ctx, "aa-batch-1", 90),
        await decided(ctx, "aa-batch-2", 80),
        await decided(ctx, "aa-batch-3", 70),
        await decided(ctx, "aa-batch-4", 60),
        await decided(ctx, "aa-batch-5", 50)
      ]
      expect(await tick(ctx.tenant.userId)).toMatchObject({ selected: 2, created: 2 })
      expect(new Set(await vacancyOrder(ctx))).toEqual(new Set([v[0]!.vacancyId, v[1]!.vacancyId]))

      expect(await tick(ctx.tenant.userId)).toMatchObject({ selected: 2, created: 2 })
      expect(new Set(await vacancyOrder(ctx))).toEqual(
        new Set([v[0], v[1], v[2], v[3]].map((item) => item!.vacancyId))
      )
    }, 60_000)

    test("min_priority is a floor", async () => {
      const ctx = await setup("aa-minprio")
      const v = [await decided(ctx, "aa-minprio-1", 90), await decided(ctx, "aa-minprio-2", 70), await decided(ctx, "aa-minprio-3", 50)]
      // priority = fit * 0.5 without a publish date: 45, 35, 25
      expect(v.map((item) => item.decision.priority)).toEqual([45, 35, 25])
      await configure(ctx, { autoMode: "drafts", minPriority: 30, batchSize: 10 })
      expect(await tick(ctx.tenant.userId)).toMatchObject({ selected: 2, created: 2 })
      expect(new Set(await vacancyOrder(ctx))).toEqual(new Set([v[0]!.vacancyId, v[1]!.vacancyId]))
    }, 60_000)

    test("sort decides which vacancy goes first: priority, fit-independent salary", async () => {
      const ctx = await setup("aa-sort")
      // the best fit pays the least
      const low = await decided(ctx, "aa-sort-low", 90, { salaryFrom: 100_000 })
      const high = await decided(ctx, "aa-sort-high", 60, { salaryFrom: 500_000 })

      await configure(ctx, { autoMode: "drafts", batchSize: 1, sort: "salary" })
      expect(await tick(ctx.tenant.userId)).toMatchObject({ created: 1 })
      expect(await vacancyOrder(ctx)).toEqual([high.vacancyId])

      await configure(ctx, { autoMode: "drafts", batchSize: 1, sort: "priority" })
      expect(await tick(ctx.tenant.userId)).toMatchObject({ created: 1 })
      expect(await vacancyOrder(ctx)).toEqual([high.vacancyId, low.vacancyId])
    }, 60_000)

    test("sortDirection asc takes the opposite end of the same candidate set", async () => {
      const ctx = await setup("aa-dir")
      const best = await decided(ctx, "aa-dir-best", 90)
      await decided(ctx, "aa-dir-mid", 70)
      const worst = await decided(ctx, "aa-dir-worst", 50)

      await configure(ctx, { autoMode: "drafts", batchSize: 1, sortDirection: "asc" })
      expect(await tick(ctx.tenant.userId)).toMatchObject({ created: 1 })
      expect(await vacancyOrder(ctx)).toEqual([worst.vacancyId])

      // Back to desc: the best of what is left is the best overall.
      await configure(ctx, { sortDirection: "desc" })
      expect(await tick(ctx.tenant.userId)).toMatchObject({ created: 1 })
      expect(await vacancyOrder(ctx)).toEqual([worst.vacancyId, best.vacancyId])
    }, 60_000)

    test("sortDirection does not make decisions stale and min_priority still applies", async () => {
      const ctx = await setup("aa-dir-stale")
      const best = await decided(ctx, "aa-dir-s-best", 90)
      await decided(ctx, "aa-dir-s-low", 50)
      // priority 45 and 25: the floor of 30 leaves only the best one, even worst-first
      await configure(ctx, { autoMode: "drafts", batchSize: 1, minPriority: 30, sortDirection: "asc" })
      expect(await tick(ctx.tenant.userId)).toMatchObject({ selected: 1, created: 1 })
      expect(await vacancyOrder(ctx)).toEqual([best.vacancyId])
    }, 60_000)

    test("newest asc takes the oldest published first and keeps vacancies without a date last", async () => {
      const ctx = await setup("aa-dir-new")
      const fresh = await decided(ctx, "aa-dir-n-fresh", 80)
      const old = await decided(ctx, "aa-dir-n-old", 80)
      const undated = await decided(ctx, "aa-dir-n-null", 80)
      await owner((tx) =>
        tx.execute(sql`
          update vacancy set published_at = case id
            when ${fresh.vacancyId} then now() - interval '1 hour'
            when ${old.vacancyId} then now() - interval '10 days'
            else null end
          where id in (${fresh.vacancyId}, ${old.vacancyId}, ${undated.vacancyId})
        `)
      )

      await configure(ctx, { autoMode: "drafts", batchSize: 1, sort: "newest", sortDirection: "asc" })
      expect(await tick(ctx.tenant.userId)).toMatchObject({ created: 1 })
      expect(await vacancyOrder(ctx)).toEqual([old.vacancyId])
      expect(await tick(ctx.tenant.userId)).toMatchObject({ created: 1 })
      expect(await vacancyOrder(ctx)).toEqual([old.vacancyId, fresh.vacancyId])

      await configure(ctx, { sortDirection: "desc" })
      expect(await tick(ctx.tenant.userId)).toMatchObject({ created: 1 })
      expect(await vacancyOrder(ctx)).toEqual([old.vacancyId, fresh.vacancyId, undated.vacancyId])
    }, 60_000)

    test("a pair row wins for its resume: off there, drafts for the rest", async () => {
      const ctx = await setup("aa-pair")
      const resume = await createResume(ctx.tenant.userId, ctx.tenant.accountId, "aa-pair-resume")
      await configure(ctx, { autoMode: "drafts", batchSize: 10 })
      await configure(ctx, { autoMode: "off" }, resume.id)
      const withResume = await decided(ctx, "aa-pair-r", 90, { resumeId: resume.id })
      const plain = await decided(ctx, "aa-pair-p", 80)
      expect((await support.evaluateVacancy(ctx.tenant.userId, {
        vacancyId: plain.vacancyId,
        hhAccountId: ctx.tenant.accountId,
        fit: 80
      })).resumeId ?? null).toBeNull()

      await tick(ctx.tenant.userId)
      const made = await vacancyOrder(ctx)
      expect(made).toEqual([plain.vacancyId])
      expect(made).not.toContain(withResume.vacancyId)
    }, 60_000)
  })

  /* ------------------------------------------------------------------------ */
  /* Manual applications                                                      */
  /* ------------------------------------------------------------------------ */

  describe("manual applications", () => {
    test("are never selected again, written for or parked", async () => {
      const ctx = await setup("aa-manual")
      await configure(ctx, { autoMode: "auto" })
      const { vacancyId } = await decided(ctx, "aa-manual-1", 90)
      // the operator already has a draft and a queued application for other vacancies
      const draftVacancy = await support.seedVacancy("aa-manual-draft")
      const queuedVacancy = await support.seedVacancy("aa-manual-queued")
      const draft = await support.seedApplication({
        userId: ctx.tenant.userId,
        accountId: ctx.tenant.accountId,
        vacancyId: draftVacancy,
        state: "draft"
      })
      const queued = await support.seedApplication({
        userId: ctx.tenant.userId,
        accountId: ctx.tenant.accountId,
        vacancyId: queuedVacancy,
        state: "queued"
      })
      // and one for the decided vacancy itself
      const manual = await support.seedApplication({
        userId: ctx.tenant.userId,
        accountId: ctx.tenant.accountId,
        vacancyId,
        state: "draft"
      })

      for (let round = 0; round < 3; round++) {
        expect(await tick(ctx.tenant.userId)).toMatchObject({
          created: 0,
          writingEnqueued: 0,
          kitsSet: 0,
          needsHuman: 0
        })
      }
      const rows = await applicationsOf(ctx.tenant.accountId)
      expect(rows).toHaveLength(3)
      expect(rows.every((row) => row.auto_run === null)).toBe(true)
      expect(rows.find((row) => row.id === draft)!.state).toBe("draft")
      expect(rows.find((row) => row.id === queued)!.state).toBe("queued")
      expect(rows.find((row) => row.id === manual)!.state).toBe("draft")
      expect(await writingJobs(ctx.tenant.accountId)).toHaveLength(0)
      expect(await support.formReadJobsOf(vacancyId)).toHaveLength(0)
    }, 60_000)
  })

  /* ------------------------------------------------------------------------ */
  /* The schedule kind                                                        */
  /* ------------------------------------------------------------------------ */

  describe("the apply schedule kind", () => {
    test("runs through the dispatcher and records the counts", async () => {
      const ctx = await setup("aa-schedule")
      await configure(ctx, { autoMode: "drafts" })
      await decided(ctx, "aa-schedule-1", 90)

      const schedule = await support.scheduleUpsert(ctx.tenant.userId, {
        kind: "apply",
        targetId: "global",
        intervalMinutes: 15
      })
      expect(schedule.kind).toBe("apply")
      await support.setScheduleNextRun(schedule.id, new Date(Date.now() - 60_000))

      const outcomes = await support.runDueSchedulesWithGateways(ctx.tenant.userId, {})
      const ran = outcomes.find((outcome) => outcome.scheduleId === schedule.id)
      expect(ran).toMatchObject({ kind: "apply", ok: true })
      expect(ran?.result?.detail).toMatchObject({ accounts: 1, selected: 1, created: 1 })
      expect(await applicationsOf(ctx.tenant.accountId)).toHaveLength(1)
    }, 60_000)
  })
  /* ------------------------------------------------------------------------ */
  /* Which resume                                                             */
  /* ------------------------------------------------------------------------ */

  describe("resume resolution", () => {
    const resumesOf = (accountId: string) =>
      owner((tx) =>
        tx
          .execute(sql`select id, title, is_active from resume where hh_account_id = ${accountId} order by created_at, id`)
          .pipe(Effect.map((r) => r.rows as unknown as ReadonlyArray<{ id: string; title: string; is_active: boolean }>))
      )

    /** The setup resume (active) plus a second one; `activeSecond` and the update order are set by SQL. */
    const withTwoResumes = async (ctx: Ctx, label: string, options: { activeSecond?: boolean; secondNewer?: boolean } = {}) => {
      await createResume(ctx.tenant.userId, ctx.tenant.accountId, `aa-resume2-${label}`)
      const [first, second] = await resumesOf(ctx.tenant.accountId)
      // A trigger stamps updated_at with now(): the resume touched in the LATER transaction is the newer.
      const touch = (id: string, active: boolean) =>
        owner((tx) => tx.execute(sql`update resume set is_active = ${active} where id = ${id}`))
      const secondActive = options.activeSecond === true
      if (options.secondNewer === true) {
        await touch(first!.id, true)
        await touch(second!.id, secondActive)
      } else {
        await touch(second!.id, secondActive)
        await touch(first!.id, true)
      }
      return { first: first!, second: second! }
    }

    const appRows = (accountId: string) =>
      owner((tx) =>
        tx
          .execute(sql`select id, resume_id, state, auto_run, last_error from application where hh_account_id = ${accountId} order by created_at, id`)
          .pipe(
            Effect.map(
              (r) =>
                r.rows as unknown as ReadonlyArray<{
                  id: string
                  resume_id: string | null
                  state: string
                  auto_run: string | null
                  last_error: string | null
                }>
            )
          )
      )

    const jobPayloads = (accountId: string, stage: string) =>
      owner((tx) =>
        tx
          .execute(sql`select payload from harness_jobs where hh_account_id = ${accountId} and stage = ${stage} order by created_at`)
          .pipe(Effect.map((r) => r.rows.map((row) => (row as { payload: Record<string, any> }).payload)))
      )

    test("a decision without a resume uses the single active resume for the application, the letter and the submit", async () => {
      const ctx = await setup("aa-res-one")
      const { first, second } = await withTwoResumes(ctx, "aa-res-one")
      await configure(ctx, { autoMode: "auto" })
      await decided(ctx, "aa-res-one-1", 90)

      const view = await support.runAs(
        ctx.tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* AutoApplyViewService).preview({ hhAccountId: ctx.tenant.accountId })
        })
      )
      expect(view.willTake[0]).toMatchObject({ resumeId: first.id, resumeTitle: first.title })
      expect(view.fallbackResume).toMatchObject({ id: first.id, title: first.title, others: [second.title] })

      expect(await tick(ctx.tenant.userId)).toMatchObject({ created: 1 })
      const [app] = await appRows(ctx.tenant.accountId)
      expect(app!.resume_id).toBe(first.id)

      await readForms(ctx, responseHtml)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ writingEnqueued: 1 })
      const [writing] = await jobPayloads(ctx.tenant.accountId, "inference")
      expect(String(writing!.prompt)).toContain(`Resume ${first.title}`)
      expect(String(writing!.prompt)).not.toContain(`Resume ${second.title}`)

      await writeLetters(ctx, GOOD_DRAFT)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ submitQueued: 1 })
      const [submit] = await jobPayloads(ctx.tenant.accountId, "submit")
      expect(submit!.resumeTitle).toBe(first.title)
    }, 120_000)

    test("with several active resumes the most recently updated one is used", async () => {
      const ctx = await setup("aa-res-two")
      const { second } = await withTwoResumes(ctx, "aa-res-two", { activeSecond: true, secondNewer: true })
      await configure(ctx, { autoMode: "drafts" })
      await decided(ctx, "aa-res-two-1", 90)
      await tick(ctx.tenant.userId)
      const [app] = await appRows(ctx.tenant.accountId)
      expect(app!.resume_id).toBe(second.id)
    }, 60_000)

    test("no active resume and several resumes: parked for a human, no writing job", async () => {
      const ctx = await setup("aa-res-none")
      await withTwoResumes(ctx, "aa-res-none")
      await owner((tx) => tx.execute(sql`update resume set is_active = false where hh_account_id = ${ctx.tenant.accountId}`))
      await configure(ctx, { autoMode: "auto" })
      await decided(ctx, "aa-res-none-1", 90)

      expect(await tick(ctx.tenant.userId)).toMatchObject({ created: 1, needsHuman: 1 })
      const [app] = await appRows(ctx.tenant.accountId)
      expect(app!.state).toBe("needs_human")
      expect(app!.resume_id).toBeNull()
      expect(app!.last_error).toContain("не выбрано резюме для откликов")
      expect((await applicationsOf(ctx.tenant.accountId))[0]!.blocked_reason).toBe("no_resume")
      await readForms(ctx, responseHtml)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ writingEnqueued: 0 })
      expect(await writingJobs(ctx.tenant.accountId)).toHaveLength(0)
      expect(await submitCount(app!.id)).toBe(0)
    }, 60_000)

    test("an existing auto draft without a resume is backfilled before the letter", async () => {
      const ctx = await setup("aa-res-fill")
      const { first } = await withTwoResumes(ctx, "aa-res-fill")
      await configure(ctx, { autoMode: "drafts" })
      await decided(ctx, "aa-res-fill-1", 90)
      await tick(ctx.tenant.userId)
      await owner((tx) => tx.execute(sql`update application set resume_id = null where hh_account_id = ${ctx.tenant.accountId}`))
      await readForms(ctx, responseHtml)

      expect(await tick(ctx.tenant.userId)).toMatchObject({ writingEnqueued: 1 })
      const [app] = await appRows(ctx.tenant.accountId)
      expect(app!.resume_id).toBe(first.id)
      const [writing] = await jobPayloads(ctx.tenant.accountId, "inference")
      expect(String(writing!.prompt)).toContain(`Resume ${first.title}`)
    }, 60_000)

    test("a backfill that would collide with an existing (account, vacancy, resume) row is parked", async () => {
      const ctx = await setup("aa-res-clash")
      const { first } = await withTwoResumes(ctx, "aa-res-clash")
      await configure(ctx, { autoMode: "drafts" })
      const { vacancyId } = await decided(ctx, "aa-res-clash-1", 90)
      await tick(ctx.tenant.userId)
      await readForms(ctx, responseHtml)
      await owner((tx) =>
        Effect.gen(function*() {
          yield* tx.execute(sql`update application set resume_id = null where hh_account_id = ${ctx.tenant.accountId}`)
          yield* tx.execute(sql`insert into application (user_id, hh_account_id, vacancy_id, resume_id, state)
            values (${ctx.tenant.userId}, ${ctx.tenant.accountId}, ${vacancyId}, ${first.id}, 'draft')`)
        })
      )

      expect(await tick(ctx.tenant.userId)).toMatchObject({ needsHuman: 1, writingEnqueued: 0 })
      const rows = await appRows(ctx.tenant.accountId)
      const auto = rows.find((row) => row.auto_run !== null)!
      expect(auto.state).toBe("needs_human")
      expect(auto.resume_id).toBeNull()
      expect(auto.last_error).toContain("не выбрано резюме для откликов")
    }, 60_000)

    test("manual applications without a resume are never touched", async () => {
      const ctx = await setup("aa-res-manual")
      await withTwoResumes(ctx, "aa-res-manual")
      await configure(ctx, { autoMode: "drafts" })
      const vacancyId = await support.seedVacancyTitled("aa-res-manual-1", "DevOps engineer manual", { salaryFrom: 300_000 })
      const id = await support.seedApplication({
        userId: ctx.tenant.userId,
        accountId: ctx.tenant.accountId,
        vacancyId,
        state: "draft"
      })
      await tick(ctx.tenant.userId)
      await tick(ctx.tenant.userId)
      const [app] = await appRows(ctx.tenant.accountId)
      expect(app).toMatchObject({ id, resume_id: null, state: "draft", auto_run: null })
    }, 60_000)
  })

  /* ------------------------------------------------------------------------ */
  /* Preview and progress                                                     */
  /* ------------------------------------------------------------------------ */

  describe("preview and progress", () => {
    const previewOf = (ctx: Ctx, resumeId?: string) =>
      support.runAs(
        ctx.tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* AutoApplyViewService).preview({
            hhAccountId: ctx.tenant.accountId,
            ...(resumeId === undefined ? {} : { resumeId })
          })
        })
      )

    const progressOf = (ctx: Ctx, options: { activeOnly?: boolean; limit?: number } = {}) =>
      support.runAs(
        ctx.tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* AutoApplyViewService).progress({ hhAccountId: ctx.tenant.accountId, ...options })
        })
      )

    test("preview lists what the next tick creates, in the same order; works with mode off", async () => {
      const ctx = await setup("aa-prev")
      const v = [
        await decided(ctx, "aa-prev-1", 90),
        await decided(ctx, "aa-prev-2", 80),
        await decided(ctx, "aa-prev-3", 70),
        await decided(ctx, "aa-prev-4", 60)
      ]
      await configure(ctx, { autoMode: "off", batchSize: 2 })

      const off = await previewOf(ctx)
      expect(off.settings).toMatchObject({ autoMode: "off", batchSize: 2, sort: "priority", sortDirection: "desc" })
      expect(off.willTake.map((c) => c.vacancyId as string)).toEqual([v[0]!.vacancyId, v[1]!.vacancyId])
      expect(off.willTake.map((c) => c.rank)).toEqual([1, 2])
      expect(off.next.map((c) => c.vacancyId as string)).toEqual([v[2]!.vacancyId, v[3]!.vacancyId])
      expect(off.next.map((c) => c.rank)).toEqual([3, 4])
      expect(off.totalCandidates).toBe(4)
      expect(off.excluded).toEqual({ alreadyApplied: 0, belowMinPriority: 0 })
      expect(off.budget).toMatchObject({ used: 0, limit: 200, remaining: 200, oldest: null })
      expect(off.willTake[0]).toMatchObject({ fit: 90, priority: 45, employerName: null })

      await configure(ctx, { autoMode: "drafts" })
      const before = await previewOf(ctx)
      expect(before.willTake.map((c) => c.vacancyId as string)).toEqual(off.willTake.map((c) => c.vacancyId as string))
      expect(await tick(ctx.tenant.userId)).toMatchObject({ created: 2 })
      expect((await applicationsOf(ctx.tenant.accountId)).map((row) => row.vacancy_id)).toEqual(
        before.willTake.map((c) => c.vacancyId as string)
      )

      // the two taken are now "already applied"; the next ones are the next take
      const after = await previewOf(ctx)
      expect(after.excluded.alreadyApplied).toBe(2)
      expect(after.willTake.map((c) => c.vacancyId as string)).toEqual(before.next.map((c) => c.vacancyId as string))
      expect(after.next).toHaveLength(0)
    }, 90_000)

    test("exclusions, asc direction and a smaller budget", async () => {
      const ctx = await setup("aa-prev-ex")
      const best = await decided(ctx, "aa-pex-best", 90)
      const mid = await decided(ctx, "aa-pex-mid", 70)
      const low = await decided(ctx, "aa-pex-low", 50)
      // priority 45 / 35 / 25; the floor of 30 removes `low`
      await configure(ctx, { autoMode: "off", batchSize: 5, minPriority: 30, sortDirection: "asc", dailyLimit: 1 })

      const view = await previewOf(ctx)
      expect(view.excluded.belowMinPriority).toBe(1)
      expect(view.totalCandidates).toBe(2)
      // asc: worst first; the budget of one slot leaves a single willTake
      expect(view.willTake.map((c) => c.vacancyId as string)).toEqual([mid.vacancyId])
      expect(view.next.map((c) => c.vacancyId as string)).toEqual([best.vacancyId])
      expect(view.budget).toMatchObject({ limit: 1, remaining: 1 })

      // a manual application for `best` takes it out of the candidates
      await support.seedApplication({
        userId: ctx.tenant.userId,
        accountId: ctx.tenant.accountId,
        vacancyId: best.vacancyId,
        state: "draft"
      })
      const again = await previewOf(ctx)
      expect(again.excluded.alreadyApplied).toBe(1)
      expect(again.totalCandidates).toBe(1)
      expect(low.vacancyId).not.toBe(mid.vacancyId)
    }, 60_000)

    test("progress follows an application: waiting, writing, kit ready; the letter is returned", async () => {
      const ctx = await setup("aa-prog")
      await configure(ctx, { autoMode: "drafts" })
      await decided(ctx, "aa-prog-1", 90)
      expect((await progressOf(ctx)).items).toHaveLength(0)

      await tick(ctx.tenant.userId)
      let view = await progressOf(ctx)
      expect(view.items).toHaveLength(1)
      expect(view.items[0]).toMatchObject({ autoRun: "drafts", state: "draft", stage: "waiting", formReadStatus: "pending" })
      expect(view.items[0]!.stageDetail).toBe("Ждёт чтения формы")
      expect(view.summary.waiting).toBe(1)

      await readForms(ctx, responseHtml)
      view = await progressOf(ctx)
      expect(view.items[0]).toMatchObject({ stage: "waiting", formReadStatus: "done" })

      await tick(ctx.tenant.userId)
      view = await progressOf(ctx)
      expect(view.items[0]).toMatchObject({ stage: "writing" })
      expect(view.items[0]!.stageDetail).toBe("Пишется письмо (попытка 1 из 3)")
      expect(view.items[0]!.writingJob).toMatchObject({ status: "pending", attempts: 0, maxAttempts: 3 })
      expect(view.summary.writing).toBe(1)
      expect((await progressOf(ctx, { activeOnly: true })).items).toHaveLength(1)

      await writeLetters(ctx, GOOD_DRAFT)
      await tick(ctx.tenant.userId)
      view = await progressOf(ctx)
      expect(view.items[0]).toMatchObject({ stage: "kit_ready" })
      expect(view.items[0]!.answersCount).toBeGreaterThanOrEqual(5)
      expect(view.items[0]!.writingJob?.status).toBe("done")
      expect(view.summary.kit_ready).toBe(1)
      // the fixture form takes no letter, so store one by hand to see the text come back whole
      expect(view.items[0]!.letter).toBeNull()
      await owner((tx) =>
        tx.execute(sql`update application_kit set letter = ${"Здравствуйте.\nПолный текст письма."} where application_id = ${view.items[0]!.applicationId}`)
      )
      expect((await progressOf(ctx)).items[0]!.letter).toBe("Здравствуйте.\nПолный текст письма.")
    }, 120_000)

    test("progress: an auto kit shows the submit queue; letter text is returned when the form takes a letter", async () => {
      const ctx = await setup("aa-prog-auto")
      await configure(ctx, { autoMode: "auto" })
      await decided(ctx, "aa-prog-auto-1", 90)
      await tick(ctx.tenant.userId)
      await readForms(ctx, responseHtml)
      await tick(ctx.tenant.userId)
      await writeLetters(ctx, GOOD_DRAFT)
      await tick(ctx.tenant.userId)

      const view = await progressOf(ctx)
      expect(view.items[0]).toMatchObject({ autoRun: "auto", state: "queued", stage: "submitting" })
      expect(view.items[0]!.stageDetail).toBe("Отправка в очереди")
      expect(view.summary.submitting).toBe(1)
      // the fixture form takes no letter: the field is null, never undefined
      expect(view.items[0]!.letter).toBeNull()
    }, 120_000)

    test("progress: a failed writing job ends as needs_human; code forms too", async () => {
      const ctx = await setup("aa-prog-fail")
      await configure(ctx, { autoMode: "drafts" })
      await decided(ctx, "aa-prog-fail-1", 90)
      await tick(ctx.tenant.userId)
      await readForms(ctx, responseHtml)
      await tick(ctx.tenant.userId)
      for (let attempt = 0; attempt < 3; attempt++) {
        await leaseAndComplete(ctx, "inference", { tag: "inference_failed", message: "agent exited 1" })
        await owner((tx) => tx.execute(sql`update harness_jobs set run_at = now() where stage = 'inference'`))
      }
      // before the runner looks again the dead job is already visible
      let view = await progressOf(ctx)
      expect(view.items[0]!.stage).toBe("failed")

      await tick(ctx.tenant.userId)
      view = await progressOf(ctx)
      expect(view.items[0]).toMatchObject({ state: "needs_human", stage: "needs_human" })
      expect(view.items[0]!.stageDetail).toContain("Нужен человек (письмо не написано): ")
      expect(view.items[0]!.blockedReason).toBe("writing_failed")
      expect(view.items[0]!.lastError).toContain("writing job")
      expect(view.summary.needs_human).toBe(1)
      expect((await progressOf(ctx, { activeOnly: true })).items).toHaveLength(0)
    }, 120_000)

    const retryOf = (ctx: Ctx, input: { applicationId?: string; hhAccountId?: string } = {}) =>
      support.runAs(
        ctx.tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* AutoApplyViewService).retry(input as never)
        })
      )

    const killWriting = (accountId: string) =>
      owner((tx) =>
        tx.execute(
          sql`update harness_jobs set status = 'dead', last_error = 'quota is over'
              where stage = 'inference' and hh_account_id = ${accountId}
                and idempotency_key like 'autoapply:writing:%' and idempotency_key not like '%:retried:%'`
        )
      )

    /** An application whose form is read and whose first writing job is dead and parked. */
    const parkedByDeadJob = async (label: string, mode: "drafts" | "auto") => {
      const ctx = await setup(label)
      await configure(ctx, { autoMode: mode })
      await decided(ctx, `${label}-1`, 90)
      await tick(ctx.tenant.userId)
      await readForms(ctx, responseHtml)
      await tick(ctx.tenant.userId)
      await killWriting(ctx.tenant.accountId)
      await tick(ctx.tenant.userId)
      const [row] = await applicationsOf(ctx.tenant.accountId)
      // Автоотклик сначала ждёт автоповтор, черновик сразу у человека.
      expect(row!.state).toBe(mode === "auto" ? "preparing" : "needs_human")
      return { ctx, id: row!.id }
    }

    test("retry: a dead writing job is replaced on the next tick and the application proceeds", async () => {
      const { ctx, id } = await parkedByDeadJob("aa-retry-1", "drafts")
      expect((await progressOf(ctx)).items[0]).toMatchObject({ stage: "needs_human", retryable: true })

      const result = await retryOf(ctx, { applicationId: id })
      expect(result).toEqual({ retried: 1, skipped: [] })
      const [row] = await applicationsOf(ctx.tenant.accountId)
      expect(row).toMatchObject({ state: "draft", last_error: null, intent_at: null })
      // the dead job stays as history under a retired key; no model call happened inline
      const jobs = (await owner((tx) =>
        tx
          .execute(sql`select status, idempotency_key from harness_jobs
                       where stage = 'inference' and hh_account_id = ${ctx.tenant.accountId}`)
          .pipe(Effect.map((r) => r.rows as unknown as ReadonlyArray<{ status: string; idempotency_key: string }>))
      ))
      expect(jobs).toHaveLength(1)
      expect(jobs[0]!.idempotency_key).toMatch(/:retried:1$/)
      expect((await progressOf(ctx)).items[0]).toMatchObject({ retryable: false, state: "draft" })

      // a second call is a no-op
      const again = await retryOf(ctx, { applicationId: id })
      expect(again.retried).toBe(0)
      expect(again.skipped).toHaveLength(1)
      expect(await retryOf(ctx, { hhAccountId: ctx.tenant.accountId })).toEqual({ retried: 0, skipped: [] })
      expect(await writingJobs(ctx.tenant.accountId)).toHaveLength(1)

      // the next tick queues one fresh job under the base key
      expect(await tick(ctx.tenant.userId)).toMatchObject({ writingEnqueued: 1 })
      const after = await writingJobs(ctx.tenant.accountId)
      expect(after).toHaveLength(2)
      expect(after.filter((job) => !(job as { idempotency_key?: string }).idempotency_key?.includes(":retried:"))).toHaveLength(1)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ writingEnqueued: 0 })

      await writeLetters(ctx, GOOD_DRAFT)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ kitsSet: 1 })
      expect(await kitOf(id)).not.toBeNull()
      expect((await progressOf(ctx)).items[0]).toMatchObject({ stage: "kit_ready", retryable: false })
    }, 120_000)

    test("retry: all stopped ones of an account at once; a failed-but-not-yet-parked one too; auto goes back to preparing", async () => {
      const { ctx, id } = await parkedByDeadJob("aa-retry-auto", "auto")
      expect((await applicationsOf(ctx.tenant.accountId))[0]).toMatchObject({
        state: "preparing",
        blocked_reason: "writing_failed"
      })
      const result = await retryOf(ctx, { hhAccountId: ctx.tenant.accountId })
      expect(result).toEqual({ retried: 1, skipped: [] })
      expect((await applicationsOf(ctx.tenant.accountId))[0]).toMatchObject({
        state: "preparing",
        last_error: null,
        blocked_reason: null,
        retry_at: null,
        auto_retries: 0
      })
      expect(await tick(ctx.tenant.userId)).toMatchObject({ writingEnqueued: 1 })
      await writeLetters(ctx, GOOD_DRAFT)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ kitsSet: 1, submitQueued: 1 })
      expect(await submitCount(id)).toBe(1)
    }, 120_000)

    test("retry: sent, intent-marked and manual applications are never touched", async () => {
      const { ctx, id } = await parkedByDeadJob("aa-retry-safe", "drafts")
      await owner((tx) => tx.execute(sql`update application set intent_at = now() where id = ${id}`))
      expect((await progressOf(ctx)).items[0]!.retryable).toBe(false)
      const blocked = await retryOf(ctx, { applicationId: id })
      expect(blocked.retried).toBe(0)
      expect(blocked.skipped[0]!.reason).toContain("отправка")
      await owner((tx) => tx.execute(sql`update application set intent_at = null, state = 'submitted' where id = ${id}`))
      expect((await retryOf(ctx, { applicationId: id })).retried).toBe(0)
      expect((await retryOf(ctx, { hhAccountId: ctx.tenant.accountId })).retried).toBe(0)

      const vacancy = await support.seedVacancy("aa-retry-manual-1")
      const manual = await support.seedApplication({
        userId: ctx.tenant.userId,
        accountId: ctx.tenant.accountId,
        vacancyId: vacancy,
        state: "draft"
      })
      const result = await retryOf(ctx, { applicationId: manual })
      expect(result.retried).toBe(0)
      expect(result.skipped).toHaveLength(1)
      expect((await retryOf(ctx, { hhAccountId: ctx.tenant.accountId })).retried).toBe(0)
    }, 120_000)

    test("retry: bounded to five replacements per application", async () => {
      const { ctx, id } = await parkedByDeadJob("aa-retry-cap", "drafts")
      for (let n = 1; n <= 5; n++) {
        expect((await retryOf(ctx, { applicationId: id })).retried).toBe(1)
        expect(await tick(ctx.tenant.userId)).toMatchObject({ writingEnqueued: 1 })
        await killWriting(ctx.tenant.accountId)
        await tick(ctx.tenant.userId)
      }
      expect((await progressOf(ctx)).items[0]!.retryable).toBe(false)
      const capped = await retryOf(ctx, { applicationId: id })
      expect(capped.retried).toBe(0)
      expect(capped.skipped[0]!.reason).toContain("лимит")
      expect((await applicationsOf(ctx.tenant.accountId))[0]!.state).toBe("needs_human")
    }, 180_000)

    test("manual applications are not in the progress", async () => {
      const ctx = await setup("aa-prog-manual")
      const vacancy = await support.seedVacancy("aa-prog-manual-1")
      await support.seedApplication({
        userId: ctx.tenant.userId,
        accountId: ctx.tenant.accountId,
        vacancyId: vacancy,
        state: "draft"
      })
      const view = await progressOf(ctx)
      expect(view.items).toHaveLength(0)
      expect(Object.values(view.summary).reduce((a, b) => a + b, 0)).toBe(0)
    }, 60_000)
  })

  /* ------------------------------------------------------------------------ */
  /* Preparing and blocked reasons                                            */
  /* ------------------------------------------------------------------------ */

  describe("preparing and blocked reasons", () => {
    const HOUR = 3_600_000

    const rowOfApp = async (accountId: string) => (await applicationsOf(accountId))[0]!

    /** The retry moment is in the past: the next pass picks the application up. */
    const dueNow = (id: string) =>
      owner((tx) => tx.execute(sql`update application set retry_at = now() - interval '1 minute' where id = ${id}`))

    const killLatestWriting = (accountId: string) =>
      owner((tx) =>
        tx.execute(
          sql`update harness_jobs set status = 'dead', last_error = 'harness offline'
              where stage = 'inference' and hh_account_id = ${accountId}
                and idempotency_key like 'autoapply:writing:%' and idempotency_key not like '%:retried:%'`
        )
      )

    test("the migration moves waiting auto applications to preparing and keeps the rest", async () => {
      const ctx = await setup("aa-mig")
      const migration = readFileSync(
        join(import.meta.dir, "../../migrations/0046_application_preparing.sql"),
        "utf8"
      )
      const statement = /(update application\s+set state = 'preparing'[^;]*;)/.exec(migration)![1]!
      const make = async (label: string, input: { autoRun?: "auto" | "drafts"; intentAt?: Date }) =>
        support.seedApplication({
          userId: ctx.tenant.userId,
          accountId: ctx.tenant.accountId,
          vacancyId: await support.seedVacancy(label),
          state: "queued",
          ...(input.autoRun === undefined ? {} : { autoRun: input.autoRun }),
          ...(input.intentAt === undefined ? {} : { intentAt: input.intentAt })
        })
      const waiting = await make("aa-mig-waiting", { autoRun: "auto" })
      const holding = await make("aa-mig-holding", { autoRun: "auto", intentAt: new Date() })
      const manual = await make("aa-mig-manual", {})
      await owner((tx) => tx.execute(sql.raw(statement)))
      const states = new Map((await applicationsOf(ctx.tenant.accountId)).map((row) => [row.id, row.state]))
      expect(states.get(waiting)).toBe("preparing")
      expect(states.get(holding)).toBe("queued")
      expect(states.get(manual)).toBe("queued")
      // The closed set of codes is enforced by the database.
      await expect(
        owner((tx) => tx.execute(sql`update application set blocked_reason = 'nonsense' where id = ${waiting}`))
      ).rejects.toThrow()
    }, 60_000)

    test("an auto application is preparing until the gate claims a slot, then queued without a reason", async () => {
      const ctx = await setup("aa-prep")
      await configure(ctx, { autoMode: "auto" })
      await decided(ctx, "aa-prep-1", 90)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ created: 1 })
      expect(await rowOfApp(ctx.tenant.accountId)).toMatchObject({
        state: "preparing",
        intent_at: null,
        blocked_reason: null
      })

      await readForms(ctx, responseHtml)
      await tick(ctx.tenant.userId)
      expect((await rowOfApp(ctx.tenant.accountId)).state).toBe("preparing")
      await writeLetters(ctx, GOOD_DRAFT)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ kitsSet: 1, submitQueued: 1 })
      const row = await rowOfApp(ctx.tenant.accountId)
      expect(row).toMatchObject({ state: "queued", blocked_reason: null, retry_at: null })
      expect(row.intent_at).not.toBeNull()
    }, 120_000)

    test("the daily cap keeps an auto application preparing with retry_at; the runner resumes it once a slot frees", async () => {
      const ctx = await setup("aa-cap")
      await configure(ctx, { autoMode: "auto" })
      await decided(ctx, "aa-cap-1", 90)
      await tick(ctx.tenant.userId)
      await readForms(ctx, responseHtml)
      await tick(ctx.tenant.userId)

      // Лимит 1, и слот уже занят чужим откликом аккаунта.
      await configure(ctx, { autoMode: "auto", dailyLimit: 1 })
      const holder = await support.seedApplication({
        userId: ctx.tenant.userId,
        accountId: ctx.tenant.accountId,
        vacancyId: await support.seedVacancy("aa-cap-holder"),
        state: "queued",
        intentAt: new Date()
      })
      await writeLetters(ctx, GOOD_DRAFT)
      const parked = await tick(ctx.tenant.userId)
      expect(parked).toMatchObject({ kitsSet: 0, submitQueued: 0, needsHuman: 0 })
      const id = (await rowOfApp(ctx.tenant.accountId)).id
      const waiting = (await applicationsOf(ctx.tenant.accountId)).find((row) => row.id === id)!
      expect(waiting).toMatchObject({ state: "preparing", blocked_reason: "daily_cap" })
      expect(waiting.last_error).toContain("daily limit 1 reached")
      expect(waiting.retry_at!.getTime()).toBeGreaterThan(Date.now() + 20 * HOUR)
      expect(await submitCount(id)).toBe(0)

      // retry_at в будущем: проход заявку не трогает.
      expect(await tick(ctx.tenant.userId)).toMatchObject({ waiting: 0, submitQueued: 0, needsHuman: 0 })

      // Слот освободился, время пришло: раннер сам ставит отправку и снимает причину.
      await owner((tx) =>
        tx.execute(sql`update application set intent_at = now() - interval '25 hours' where id = ${holder}`)
      )
      await dueNow(id)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ kitsSet: 1, submitQueued: 1 })
      const sent = (await applicationsOf(ctx.tenant.accountId)).find((row) => row.id === id)!
      expect(sent).toMatchObject({ state: "queued", blocked_reason: null, retry_at: null })
      expect(await submitCount(id)).toBe(1)
    }, 120_000)

    test("a failed writing job is retried with a new job after 1h, 4h and 12h, then goes to needs_human", async () => {
      const ctx = await setup("aa-wretry")
      await configure(ctx, { autoMode: "auto" })
      await decided(ctx, "aa-wretry-1", 90)
      await tick(ctx.tenant.userId)
      await readForms(ctx, responseHtml)
      await tick(ctx.tenant.userId)
      expect(await writingJobs(ctx.tenant.accountId)).toHaveLength(1)

      const expectedWaits = [1, 4, 12]
      for (let n = 0; n < 3; n++) {
        await killLatestWriting(ctx.tenant.accountId)
        const before = Date.now()
        await tick(ctx.tenant.userId)
        const row = await rowOfApp(ctx.tenant.accountId)
        expect(row).toMatchObject({ state: "preparing", blocked_reason: "writing_failed", auto_retries: n + 1 })
        expect(row.last_error).toContain("harness offline")
        const wait = row.retry_at!.getTime() - before
        expect(wait).toBeGreaterThan((expectedWaits[n]! - 0.1) * HOUR)
        expect(wait).toBeLessThan((expectedWaits[n]! + 0.1) * HOUR)

        // Пока ждёт - новых задач нет.
        expect(await tick(ctx.tenant.userId)).toMatchObject({ writingEnqueued: 0 })
        expect(await writingJobs(ctx.tenant.accountId)).toHaveLength(n + 1)

        await dueNow(row.id)
        expect(await tick(ctx.tenant.userId)).toMatchObject({ writingEnqueued: 1 })
        expect(await writingJobs(ctx.tenant.accountId)).toHaveLength(n + 2)
        expect(await rowOfApp(ctx.tenant.accountId)).toMatchObject({ blocked_reason: null, retry_at: null })
      }

      // Четвёртый сбой: автоповторы кончились.
      await killLatestWriting(ctx.tenant.accountId)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ needsHuman: 1 })
      expect(await rowOfApp(ctx.tenant.accountId)).toMatchObject({
        state: "needs_human",
        blocked_reason: "writing_failed",
        retry_at: null
      })
    }, 180_000)

    test("a retried writing job still produces a kit and the submit", async () => {
      const ctx = await setup("aa-wok")
      await configure(ctx, { autoMode: "auto" })
      await decided(ctx, "aa-wok-1", 90)
      await tick(ctx.tenant.userId)
      await readForms(ctx, responseHtml)
      await tick(ctx.tenant.userId)
      await killLatestWriting(ctx.tenant.accountId)
      await tick(ctx.tenant.userId)
      const id = (await rowOfApp(ctx.tenant.accountId)).id
      await dueNow(id)
      await tick(ctx.tenant.userId)
      await writeLetters(ctx, GOOD_DRAFT)
      expect(await tick(ctx.tenant.userId)).toMatchObject({ kitsSet: 1, submitQueued: 1 })
      expect(await submitCount(id)).toBe(1)
    }, 120_000)

    test("an unrecognized form layout is permanent: needs_human with form_unreadable", async () => {
      const ctx = await setup("aa-unreadable")
      await configure(ctx, { autoMode: "auto" })
      await decided(ctx, "aa-unreadable-1", 90)
      await tick(ctx.tenant.userId)
      // Вопросы формы нечитаемы: вся форма считается незнакомой раскладкой.
      await readForms(ctx, responseHtml.replaceAll("task-question", "task-q"))
      expect(await rowOfApp(ctx.tenant.accountId)).toMatchObject({
        state: "needs_human",
        blocked_reason: "form_unreadable"
      })
    }, 120_000)

    test("a kit the check refuses is permanent: needs_human with kit_refused", async () => {
      const ctx = await setup("aa-refused")
      await configure(ctx, { autoMode: "auto" })
      await decided(ctx, "aa-refused-1", 90)
      await tick(ctx.tenant.userId)
      await readForms(ctx, responseHtml)
      await tick(ctx.tenant.userId)
      await writeLetters(ctx, INCOMPLETE_DRAFT)
      await tick(ctx.tenant.userId)
      expect(await rowOfApp(ctx.tenant.accountId)).toMatchObject({
        state: "needs_human",
        blocked_reason: "kit_refused"
      })
    }, 120_000)

    test("a failed form read waits for an automatic re-read, then goes to needs_human", async () => {
      const ctx = await setup("aa-readretry")
      await configure(ctx, { autoMode: "auto" })
      await decided(ctx, "aa-readretry-1", 90)
      await tick(ctx.tenant.userId)
      const failRead = () =>
        leaseAndComplete(ctx, "browser", { tag: "internal_error", message: "navigation timeout" } as never)
      // Харнесс сдаётся на всех попытках чтения.
      const exhaust = async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const job = await failRead()
          if (job === null) break
          await owner((tx) => tx.execute(sql`update harness_jobs set run_at = now() where stage = 'form_read'`))
        }
      }
      await exhaust()
      const first = await rowOfApp(ctx.tenant.accountId)
      expect(first).toMatchObject({ state: "preparing", blocked_reason: "form_read_failed", auto_retries: 1 })
      expect(first.retry_at!.getTime()).toBeGreaterThan(Date.now() + 0.9 * HOUR)

      // Ждёт: проход ничего не делает.
      expect(await tick(ctx.tenant.userId)).toMatchObject({ waiting: 0, needsHuman: 0 })

      // Время пришло: ставится новое чтение, и оно удаётся.
      await dueNow(first.id)
      await tick(ctx.tenant.userId)
      expect(await readForms(ctx, responseHtml)).toBe(1)
      await tick(ctx.tenant.userId)
      expect(await writingJobs(ctx.tenant.accountId)).toHaveLength(1)
      expect(await rowOfApp(ctx.tenant.accountId)).toMatchObject({ state: "preparing", blocked_reason: null })
    }, 180_000)

    test("operator approve clears the reason and the retry time", async () => {
      const ctx = await setup("aa-approve")
      await configure(ctx, { autoMode: "auto" })
      await decided(ctx, "aa-approve-1", 90)
      await tick(ctx.tenant.userId)
      await readForms(ctx, responseHtml)
      await tick(ctx.tenant.userId)
      // Кит сохранён, а слот занят: заявка ждёт в preparing.
      await configure(ctx, { autoMode: "auto", dailyLimit: 1 })
      const holder = await support.seedApplication({
        userId: ctx.tenant.userId,
        accountId: ctx.tenant.accountId,
        vacancyId: await support.seedVacancy("aa-approve-holder"),
        state: "queued",
        intentAt: new Date()
      })
      await writeLetters(ctx, GOOD_DRAFT)
      await tick(ctx.tenant.userId)
      const id = (await rowOfApp(ctx.tenant.accountId)).id
      const held = (await applicationsOf(ctx.tenant.accountId)).find((row) => row.id === id)!
      expect(held).toMatchObject({ state: "preparing", blocked_reason: "daily_cap" })

      // Оператор забирает заявку себе (needs_human с кодом) и одобряет, когда слот свободен.
      await owner((tx) =>
        tx.execute(sql`update application set state = 'needs_human' where id = ${id}`)
      )
      await owner((tx) =>
        tx.execute(sql`update application set intent_at = now() - interval '25 hours' where id = ${holder}`)
      )
      const approved = await support.applicationApprove(ctx.tenant.userId, id)
      expect(approved.state).toBe("queued")
      const after = (await applicationsOf(ctx.tenant.accountId)).find((row) => row.id === id)!
      expect(after).toMatchObject({ state: "queued", blocked_reason: null, retry_at: null, last_error: null })
    }, 120_000)

    test("operator retry clears the reason, the retry time and the auto-retry count", async () => {
      const ctx = await setup("aa-opretry")
      await configure(ctx, { autoMode: "auto" })
      await decided(ctx, "aa-opretry-1", 90)
      await tick(ctx.tenant.userId)
      await readForms(ctx, responseHtml)
      await tick(ctx.tenant.userId)
      await killLatestWriting(ctx.tenant.accountId)
      await tick(ctx.tenant.userId)
      const id = (await rowOfApp(ctx.tenant.accountId)).id
      await owner((tx) =>
        tx.execute(sql`update application set state = 'needs_human', auto_retries = 3 where id = ${id}`)
      )
      const retried = await support.applicationRetry(ctx.tenant.userId, id)
      expect(retried.state).toBe("preparing")
      expect(await rowOfApp(ctx.tenant.accountId)).toMatchObject({
        state: "preparing",
        blocked_reason: null,
        retry_at: null,
        auto_retries: 0,
        last_error: null
      })
    }, 120_000)

    test("progress shows the code, the Russian meaning and the resume time of a waiting application", async () => {
      const ctx = await setup("aa-view")
      await configure(ctx, { autoMode: "auto" })
      await decided(ctx, "aa-view-1", 90)
      await tick(ctx.tenant.userId)
      const id = (await rowOfApp(ctx.tenant.accountId)).id
      await owner((tx) =>
        tx.execute(sql`update application
          set blocked_reason = 'daily_cap', retry_at = now() + interval '5 hours', last_error = 'daily limit reached'
          where id = ${id}`)
      )
      const view = await support.runAs(
        ctx.tenant.userId,
        Effect.gen(function*() {
          return yield* (yield* AutoApplyViewService).progress({ hhAccountId: ctx.tenant.accountId })
        })
      )
      expect(view.items[0]).toMatchObject({ state: "preparing", stage: "blocked", blockedReason: "daily_cap" })
      expect(view.items[0]!.retryAt).not.toBeNull()
      expect(view.items[0]!.stageDetail).toContain("дневной лимит откликов")
      expect(view.summary.blocked).toBe(1)
    }, 120_000)
  })
}
