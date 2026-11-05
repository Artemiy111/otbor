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
import * as support from "./support.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "../../../hh/test/fixtures", name), "utf8")
const responseHtml = fixture("hh-test-response.html")
const codeHtml = fixture("hh-test-code.html")

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
          sql`select id, vacancy_id, state, auto_run, intent_at, last_error from application where hh_account_id = ${accountId} order by created_at, id`
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

    test("a form that needs a human (code question) is parked without a model call", async () => {
      const ctx = await setup("aa-drafts-code")
      await configure(ctx, { autoMode: "drafts" })
      await decided(ctx, "aa-drafts-code-1", 90)
      await tick(ctx.tenant.userId)
      await readForms(ctx, codeHtml)

      const result = await tick(ctx.tenant.userId)
      expect(result).toMatchObject({ writingEnqueued: 0, needsHuman: 1 })
      const [row] = await applicationsOf(ctx.tenant.accountId)
      expect(row!.state).toBe("needs_human")
      expect(row!.last_error).toContain("code question")
      expect(await writingJobs(ctx.tenant.accountId)).toHaveLength(0)

      // parked applications are left alone
      expect(await tick(ctx.tenant.userId)).toMatchObject({ needsHuman: 0, waiting: 0 })
    }, 60_000)

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
        ["queued", "auto"],
        ["queued", "auto"]
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
      expect(view.items[0]!.stageDetail).toContain("Нужен человек: ")
      expect(view.items[0]!.lastError).toContain("writing job")
      expect(view.summary.needs_human).toBe(1)
      expect((await progressOf(ctx, { activeOnly: true })).items).toHaveLength(0)
    }, 120_000)

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
}
