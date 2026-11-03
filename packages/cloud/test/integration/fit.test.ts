import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { FitJudgement, ResumeId, VacancyId } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "../../src/db/Database.ts"
import { CrawlRunner } from "../../src/services/CrawlRunner.ts"
import { DecisionService } from "../../src/services/DecisionService.ts"
import { FitJudgeService, type FitJudgeServiceShape } from "../../src/services/FitJudgeService.ts"
import { InferenceService } from "../../src/services/InferenceService.ts"
import { ResumeService } from "../../src/services/ResumeService.ts"
import { ScheduleService } from "../../src/services/ScheduleService.ts"
import { runDueSchedules } from "../../src/services/ScheduleWorker.ts"
import * as support from "./support.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

if (!enabled || serverUrl === null) {
  test("fit judgement integration suite is opt-in", () => {
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

  const fit = <A, E>(userId: string, use: (service: FitJudgeServiceShape) => Effect.Effect<A, E>) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        return yield* use(yield* FitJudgeService)
      })
    )

  const fitFailure = <A, E>(userId: string, use: (service: FitJudgeServiceShape) => Effect.Effect<A, E>) =>
    support.runAsFailure(
      userId,
      Effect.gen(function*() {
        return yield* use(yield* FitJudgeService)
      })
    )

  const decisions = (userId: string, options: Record<string, unknown> = {}) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        const service = yield* DecisionService
        return yield* service.list({ latestPerVacancy: true, limit: 200, ...options })
      })
    )

  const latestDecision = async (userId: string, vacancyId: string) =>
    (await decisions(userId)).find((row) => row.vacancyId === vacancyId)

  const evaluateWith = (userId: string, vacancyId: string, fitValue?: number) =>
    support.evaluateVacancy(userId, { vacancyId, ...(fitValue === undefined ? {} : { fit: fitValue }) })

  const evaluateBatch = (userId: string, vacancyIds: ReadonlyArray<string>, force = false) =>
    support.runAs(
      userId,
      Effect.gen(function*() {
        const service = yield* DecisionService
        return yield* service.evaluateBatch({ vacancyIds: vacancyIds as ReadonlyArray<VacancyId>, force })
      })
    )

  const ownerSql = (statement: ReturnType<typeof sql>) =>
    support.runAs(
      "owner",
      Effect.gen(function*() {
        const database = yield* Database
        yield* database.asOwner((tx) => tx.execute(statement))
      })
    )

  const upsertResume = (tenant: support.Tenant, externalId: string, text: string) =>
    support.runAs(
      tenant.userId,
      Effect.gen(function*() {
        const resumes = yield* ResumeService
        return yield* resumes.upsert({
          hhAccountId: tenant.accountId as never,
          source: "hh",
          externalId,
          title: "DevOps инженер",
          text,
          about: "",
          skills: ["Kubernetes", "Terraform"],
          isActive: true
        })
      })
    )

  const RESUME_TEXT = [
    "Иван Иванов",
    "Email: ivan.secret@example.com",
    "Telegram: @ivan_secret",
    "Пять лет Kubernetes и Terraform, поднимал CI/CD."
  ].join("\n")

  /** A DevOps title that passes the gate and the default apply policy. */
  const devops = (label: string) =>
    support.seedVacancyTitled(label, `DevOps engineer ${label}`, {
      salaryFrom: 400_000,
      workFormats: ["remote"],
      descriptionText: "Kubernetes Terraform Linux. Ansible."
    })

  const judgement = (overrides: Partial<FitJudgement> = {}): FitJudgement => ({
    fit: 88,
    confidence: 0.8,
    verdict: "strong",
    reasons: ["Kubernetes и Terraform в резюме"],
    disqualifiers: [],
    quotes: ["Пять лет Kubernetes"],
    ...overrides
  })

  const answer = (value: FitJudgement) => `Вот оценка:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``

  /** A tenant with a resume and `fits.length` applyable vacancies decided with those fits. */
  const setup = async (label: string, fits: ReadonlyArray<number>) => {
    const tenant = await support.seedTenant(label)
    const suffix = randomUUID().slice(0, 6)
    const resume = await upsertResume(tenant, `resume-${suffix}`, RESUME_TEXT)
    const vacancies: Array<string> = []
    for (const [index, value] of fits.entries()) {
      const id = await devops(`${label}-${index}-${suffix}`)
      await evaluateWith(tenant.userId, id, value)
      vacancies.push(id)
    }
    return { tenant, resume, vacancies, suffix }
  }

  /** Leases the next inference job as a harness and completes it with `exit`. */
  const runHarness = async (
    tenant: support.Tenant,
    exit: Parameters<typeof support.completeJob>[1]["exit"]
  ) => {
    const harness = await support.registerHarness(tenant.userId, [tenant.accountId], `fit-${randomUUID().slice(0, 6)}`, [
      "inference"
    ])
    const leased = await support.leaseNext(tenant.userId, harness.id, harness.token!, [tenant.accountId], [
      "inference"
    ])
    const job = leased.job!
    const done = await support.completeJob(tenant.userId, {
      harnessId: harness.id,
      token: harness.token!,
      jobId: job.id,
      leaseId: job.leaseId!,
      epoch: job.leaseEpoch,
      exit
    })
    return { job, done }
  }

  /* ------------------------------------------------------------------------ */
  /* Enqueue selection                                                        */
  /* ------------------------------------------------------------------------ */

  describe("enqueue", () => {
    test("picks the top-priority applyable vacancies, bounded, never twice", async () => {
      const { tenant, vacancies } = await setup("fit-select", [50, 90, 70])
      const [v50, v90, v70] = vacancies as [string, string, string]
      const cook = await support.seedVacancyTitled(`cook-${randomUUID().slice(0, 6)}`, "Cook")
      await evaluateWith(tenant.userId, cook)

      const first = await fit(tenant.userId, (s) => s.enqueue({ limit: 2 }))
      expect(first.enqueued).toBe(2)
      expect(first.remaining).toBe(1)
      expect(first.jobs.map((job) => job.vacancyId)).toEqual([v90, v70] as Array<VacancyId>)

      // The job is an ordinary inference job; the prompt carries the vacancy
      // and the resume, but not the candidate's contacts.
      const job = await support.runAs(
        tenant.userId,
        Effect.gen(function*() {
          const inference = yield* InferenceService
          return yield* inference.get(first.jobs[0]!.jobId)
        })
      )
      expect(job.kind).toBe("inference")
      expect(job.stage).toBe("inference")
      const payload = job.payload as { prompt: string; system: string; jsonSchema: unknown }
      expect(payload.prompt).toContain(`DevOps engineer fit-select-1`)
      expect(payload.prompt).toContain("Kubernetes и Terraform".slice(0, 10))
      expect(payload.prompt).not.toMatch(/ivan\.secret|ivan_secret/)
      expect(payload.system).toContain("untrusted data")
      expect(payload.jsonSchema).toBeDefined()

      const pending = await fit(tenant.userId, (s) => s.get({ vacancyId: v90 as VacancyId }))
      expect(pending).toMatchObject({ status: "pending", source: "llm", current: false, judgement: null })
      expect(pending?.inferenceJobId).toBe(first.jobs[0]!.jobId)

      // Pending rows count as covered: only the remaining one is picked up.
      const second = await fit(tenant.userId, (s) => s.enqueue({ limit: 10 }))
      expect(second.jobs.map((entry) => entry.vacancyId)).toEqual([v50] as Array<VacancyId>)
      expect(second.remaining).toBe(0)

      const third = await fit(tenant.userId, (s) => s.enqueue({}))
      expect(third.enqueued).toBe(0)

      // The gate-rejected vacancy was never a candidate.
      const rejected = await fit(tenant.userId, (s) => s.get({ vacancyId: cook as VacancyId }))
      expect(rejected).toBeNull()
    })

    test("onlyApply=false widens to every vacancy that passed the title gate", async () => {
      const { tenant } = await setup("fit-widen", [])
      const low = await devops(`widen-${randomUUID().slice(0, 6)}`)
      // fit 10 < minFit: the decision is a skip, but the title gate matched.
      await evaluateWith(tenant.userId, low, 10)

      expect((await fit(tenant.userId, (s) => s.enqueue({}))).enqueued).toBe(0)
      const widened = await fit(tenant.userId, (s) => s.enqueue({ onlyApply: false }))
      expect(widened.jobs.map((job) => job.vacancyId)).toEqual([low] as Array<VacancyId>)
    })

    test("a preset restricts the candidates", async () => {
      const { tenant, vacancies, suffix } = await setup("fit-preset", [60, 80])
      const presetId = await support.seedPreset(tenant.userId, {
        title: "only the first",
        filter: { text: `fit-preset-0-${suffix}` }
      })

      const result = await fit(tenant.userId, (s) => s.enqueue({ presetId: presetId as never }))
      expect(result.jobs.map((job) => job.vacancyId)).toEqual([vacancies[0]] as Array<VacancyId>)

      const missing = await fitFailure(tenant.userId, (s) => s.enqueue({ presetId: randomUUID() as never }))
      expect((missing as { _tag: string })._tag).toBe("NotFound")
    })

    test("needs a resume, and a foreign resume is not found", async () => {
      const tenant = await support.seedTenant("fit-no-resume")
      const none = await fitFailure(tenant.userId, (s) => s.enqueue({}))
      expect((none as { _tag: string })._tag).toBe("InvalidInput")

      const other = await setup("fit-other-resume", [70])
      const foreign = await fitFailure(tenant.userId, (s) => s.enqueue({ resumeId: other.resume.id as ResumeId }))
      expect((foreign as { _tag: string })._tag).toBe("NotFound")
    })

    test("judgements are per user", async () => {
      const { tenant, vacancies } = await setup("fit-rls", [70])
      await fit(tenant.userId, (s) => s.enqueue({}))
      const stranger = await support.seedTenant("fit-rls-stranger")

      expect(await fit(stranger.userId, (s) => s.get({ vacancyId: vacancies[0] as VacancyId }))).toBeNull()
      expect(await fit(stranger.userId, (s) => s.list({}))).toEqual([])
      expect(await fit(tenant.userId, (s) => s.list({ status: "pending" }))).toHaveLength(1)
    })
  })

  /* ------------------------------------------------------------------------ */
  /* Completion -> judgement -> decision                                      */
  /* ------------------------------------------------------------------------ */

  describe("completion of an inference job", () => {
    test("stores the judgement and re-decides the vacancy with the LLM fit", async () => {
      const { tenant, resume, vacancies } = await setup("fit-complete", [90])
      const [v] = vacancies as [string]
      const before = await latestDecision(tenant.userId, v)
      expect(before?.reasons.find((reason) => reason.code === "fit")?.detail).toBe("llm 90")

      const { jobs } = await fit(tenant.userId, (s) => s.enqueue({ force: true }))
      expect(jobs).toHaveLength(1)

      const { job, done } = await runHarness(tenant, {
        tag: "prepared",
        artifacts: { text: answer(judgement({ fit: 63, verdict: "ok" })), model: "test/model" }
      })
      expect(job.id).toBe(jobs[0]!.jobId)
      expect(done).toMatchObject({ accepted: true, status: "done" })

      const stored = await fit(tenant.userId, (s) => s.get({ vacancyId: v as VacancyId }))
      expect(stored).toMatchObject({
        status: "done",
        source: "llm",
        current: true,
        model: "test/model",
        resumeId: resume.id,
        error: null
      })
      expect(stored?.judgement).toMatchObject({ fit: 63, verdict: "ok", confidence: 0.8 })
      expect(stored?.inferenceJobId).toBe(job.id)

      const after = await latestDecision(tenant.userId, v)
      expect(after?.id).not.toBe(before?.id)
      expect(after).toMatchObject({ fit: 63, verdict: "apply", resumeId: resume.id })
      expect(after?.priority).toBeCloseTo(31.5, 1)
      expect(after?.reasons.find((reason) => reason.code === "fit")).toMatchObject({ detail: "llm 63" })

      // Nothing left to judge for this resume.
      expect((await fit(tenant.userId, (s) => s.enqueue({}))).enqueued).toBe(0)
    })

    test("a low LLM fit turns an apply into a low-fit skip", async () => {
      const { tenant, vacancies } = await setup("fit-lowers", [90])
      const [v] = vacancies as [string]
      await fit(tenant.userId, (s) => s.enqueue({}))
      await runHarness(tenant, {
        tag: "prepared",
        artifacts: {
          text: JSON.stringify(judgement({ fit: 20, verdict: "no", disqualifiers: ["нет опыта с AWS"] })),
          model: null
        }
      })

      const after = await latestDecision(tenant.userId, v)
      expect(after).toMatchObject({ verdict: "skip", fit: 20 })
      expect(after?.reasons[0]).toMatchObject({ code: "blocked_low_fit" })
    })

    test("an unparseable answer fails the judgement, keeps the decision, and is retried by the next enqueue", async () => {
      const { tenant, vacancies } = await setup("fit-garbage", [90])
      const [v] = vacancies as [string]
      const decisionBefore = await latestDecision(tenant.userId, v)
      const first = await fit(tenant.userId, (s) => s.enqueue({}))

      const { done } = await runHarness(tenant, {
        tag: "prepared",
        artifacts: { text: "Я думаю, это хорошее совпадение!" }
      })
      expect(done).toMatchObject({ accepted: true, status: "done" })

      const failed = await fit(tenant.userId, (s) => s.get({ vacancyId: v as VacancyId }))
      expect(failed?.status).toBe("failed")
      expect(failed?.error).toContain("no JSON object")
      expect(failed?.judgement).toBeNull()
      expect((await latestDecision(tenant.userId, v))?.id).toBe(decisionBefore?.id)

      const retry = await fit(tenant.userId, (s) => s.enqueue({}))
      expect(retry.jobs.map((job) => job.vacancyId)).toEqual([v] as Array<VacancyId>)
      expect(retry.jobs[0]!.jobId).not.toBe(first.jobs[0]!.jobId)
      const again = await fit(tenant.userId, (s) => s.get({ vacancyId: v as VacancyId }))
      expect(again).toMatchObject({ status: "pending", error: null })
    })

    test("an out-of-range fit is rejected, not clamped", async () => {
      const { tenant, vacancies } = await setup("fit-range", [90])
      await fit(tenant.userId, (s) => s.enqueue({}))
      await runHarness(tenant, {
        tag: "prepared",
        artifacts: { text: JSON.stringify({ ...judgement(), fit: 140 }) }
      })
      const stored = await fit(tenant.userId, (s) => s.get({ vacancyId: vacancies[0] as VacancyId }))
      expect(stored?.status).toBe("failed")
      expect(stored?.error).toContain("invalid judgement")
    })

    test("a retryable harness failure keeps the judgement pending; a terminal one fails it", async () => {
      const { tenant, vacancies } = await setup("fit-fail", [90, 80])
      const [first, second] = vacancies as [string, string]
      await fit(tenant.userId, (s) => s.enqueue({}))

      // The first leased job is the highest priority one (v90); retry later.
      await runHarness(tenant, { tag: "inference_failed", message: "agent exited 1" })
      expect((await fit(tenant.userId, (s) => s.get({ vacancyId: first as VacancyId })))?.status).toBe("pending")

      // The retry is scheduled in the future, so the next lease gets the other job.
      await runHarness(tenant, { tag: "permanent", message: "bad request" })
      const failed = await fit(tenant.userId, (s) => s.get({ vacancyId: second as VacancyId }))
      expect(failed?.status).toBe("failed")
      expect(failed?.error).toContain("permanent")
    })

    test("a judgement of a vacancy that changed meanwhile is stored but not used", async () => {
      const { tenant, vacancies } = await setup("fit-race", [90])
      const [v] = vacancies as [string]
      const before = await latestDecision(tenant.userId, v)
      await fit(tenant.userId, (s) => s.enqueue({}))

      await ownerSql(sql`update vacancy set content_hash = ${`race-${randomUUID()}`} where id = ${v}`)
      await runHarness(tenant, { tag: "prepared", artifacts: { text: JSON.stringify(judgement({ fit: 55 })) } })

      const stored = await fit(tenant.userId, (s) => s.get({ vacancyId: v as VacancyId }))
      expect(stored).toMatchObject({ status: "done", current: false })
      // The hook re-decided the new content without the stale judgement.
      const after = await latestDecision(tenant.userId, v)
      expect(after?.id).not.toBe(before?.id)
      expect(after?.reasons.find((reason) => reason.code === "fit")?.detail).toMatch(/^deterministic /)
    })
  })

  /* ------------------------------------------------------------------------ */
  /* Staleness                                                                */
  /* ------------------------------------------------------------------------ */

  describe("staleness", () => {
    test("changed vacancy content or resume makes a judgement stale; it is not recomputed, only re-enqueued", async () => {
      const { tenant, resume, vacancies, suffix } = await setup("fit-stale", [90, 80])
      const [a, b] = vacancies as [string, string]
      for (const [index, vacancy] of [a, b].entries()) {
        await fit(tenant.userId, (s) =>
          s.save({ vacancyId: vacancy as VacancyId, judgement: judgement({ fit: 70 + index }) })
        )
      }
      expect((await fit(tenant.userId, (s) => s.get({ vacancyId: a as VacancyId })))?.current).toBe(true)
      expect((await latestDecision(tenant.userId, a))?.fit).toBe(70)

      // Vacancy content change: stale, and batch evaluation falls back to the deterministic fit.
      await ownerSql(sql`update vacancy set content_hash = ${`new-${suffix}`} where id = ${a}`)
      const staleA = await fit(tenant.userId, (s) => s.get({ vacancyId: a as VacancyId }))
      expect(staleA).toMatchObject({ status: "done", current: false })
      expect((await evaluateBatch(tenant.userId, [a])).evaluated).toBe(1)
      const decisionA = await latestDecision(tenant.userId, a)
      expect(decisionA?.reasons.find((reason) => reason.code === "fit")?.detail).toMatch(/^deterministic /)

      // Resume change: the other judgement goes stale too.
      expect((await fit(tenant.userId, (s) => s.get({ vacancyId: b as VacancyId })))?.current).toBe(true)
      await upsertResume(tenant, resume.externalId, `${RESUME_TEXT}\nТеперь ещё и Go.`)
      expect((await fit(tenant.userId, (s) => s.get({ vacancyId: b as VacancyId })))?.current).toBe(false)
      expect((await evaluateBatch(tenant.userId, [b], true)).evaluated).toBe(1)
      expect((await latestDecision(tenant.userId, b))?.reasons.find((r) => r.code === "fit")?.detail).toMatch(
        /^deterministic /
      )

      // Nothing recomputes on its own; an explicit enqueue judges both again and keeps the history.
      const again = await fit(tenant.userId, (s) => s.enqueue({}))
      expect(new Set(again.jobs.map((job) => job.vacancyId))).toEqual(new Set([a, b] as Array<VacancyId>))
      const history = await fit(tenant.userId, (s) => s.list({ limit: 50 }))
      expect(history.filter((row) => row.vacancyId === a)).toHaveLength(2)
    })

    test("force re-judges a current judgement", async () => {
      const { tenant, vacancies } = await setup("fit-force", [90])
      await fit(tenant.userId, (s) => s.save({ vacancyId: vacancies[0] as VacancyId, judgement: judgement() }))

      expect((await fit(tenant.userId, (s) => s.enqueue({}))).enqueued).toBe(0)
      expect((await fit(tenant.userId, (s) => s.enqueue({ force: true }))).enqueued).toBe(1)
    })
  })

  /* ------------------------------------------------------------------------ */
  /* External save                                                            */
  /* ------------------------------------------------------------------------ */

  describe("external save", () => {
    test("stores a validated judgement and re-decides through the same path", async () => {
      const { tenant, resume, vacancies } = await setup("fit-save", [90])
      const [v] = vacancies as [string]

      const saved = await fit(tenant.userId, (s) =>
        s.save({
          vacancyId: v as VacancyId,
          judgement: judgement({ fit: 77, reasons: ["  strong stack  ", ""], quotes: ["a", "b", "c", "d", "e", "f", "g"] }),
          model: "claude-chat"
        })
      )
      expect(saved.judgement).toMatchObject({
        status: "done",
        source: "external",
        current: true,
        model: "claude-chat",
        resumeId: resume.id,
        inferenceJobId: null
      })
      expect(saved.judgement.judgement?.reasons).toEqual(["strong stack"])
      expect(saved.judgement.judgement?.quotes).toHaveLength(5)
      expect(saved.decision).toMatchObject({ fit: 77, verdict: "apply", vacancyId: v })
      expect(saved.decision.reasons.find((reason) => reason.code === "fit")?.detail).toBe("llm 77")

      // A forced batch evaluation picks the current judgement up by itself.
      const forced = await evaluateBatch(tenant.userId, [v], true)
      expect(forced.evaluated).toBe(1)
      expect((await latestDecision(tenant.userId, v))?.fit).toBe(77)

      // Saving again for the same inputs replaces the judgement (one row per key).
      await fit(tenant.userId, (s) => s.save({ vacancyId: v as VacancyId, judgement: judgement({ fit: 40, verdict: "weak" }) }))
      const rows = (await fit(tenant.userId, (s) => s.list({}))).filter((row) => row.vacancyId === v)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.judgement?.fit).toBe(40)
      expect((await latestDecision(tenant.userId, v))).toMatchObject({ verdict: "skip", fit: 40 })
    })

    test("an external judgement answers a pending LLM job; the late job result cannot overwrite it", async () => {
      const { tenant, vacancies } = await setup("fit-save-race", [90])
      const [v] = vacancies as [string]
      await fit(tenant.userId, (s) => s.enqueue({}))
      await fit(tenant.userId, (s) => s.save({ vacancyId: v as VacancyId, judgement: judgement({ fit: 91 }) }))

      await runHarness(tenant, { tag: "prepared", artifacts: { text: JSON.stringify(judgement({ fit: 12 })) } })

      const stored = await fit(tenant.userId, (s) => s.get({ vacancyId: v as VacancyId }))
      expect(stored).toMatchObject({ source: "external", current: true })
      expect(stored?.judgement?.fit).toBe(91)
      expect((await latestDecision(tenant.userId, v))?.fit).toBe(91)
    })

    test("rejects invalid judgements, unknown vacancies, and foreign or missing resumes", async () => {
      const { tenant, vacancies } = await setup("fit-save-bad", [90])
      const [v] = vacancies as [string]

      const bad = await fitFailure(tenant.userId, (s) =>
        s.save({ vacancyId: v as VacancyId, judgement: { ...judgement(), fit: 140 } })
      )
      expect((bad as { _tag: string })._tag).toBe("InvalidInput")
      const worse = await fitFailure(tenant.userId, (s) =>
        s.save({ vacancyId: v as VacancyId, judgement: { ...judgement(), confidence: 9 } })
      )
      expect((worse as { _tag: string })._tag).toBe("InvalidInput")
      expect(await fit(tenant.userId, (s) => s.get({ vacancyId: v as VacancyId }))).toBeNull()

      const unknown = await fitFailure(tenant.userId, (s) =>
        s.save({ vacancyId: randomUUID() as VacancyId, judgement: judgement() })
      )
      expect((unknown as { _tag: string })._tag).toBe("NotFound")

      const stranger = await support.seedTenant("fit-save-stranger")
      const noResume = await fitFailure(stranger.userId, (s) =>
        s.save({ vacancyId: v as VacancyId, judgement: judgement() })
      )
      expect((noResume as { _tag: string })._tag).toBe("InvalidInput")

      const { resume } = await setup("fit-save-owner", [])
      const foreign = await fitFailure(stranger.userId, (s) =>
        s.save({ vacancyId: v as VacancyId, resumeId: resume.id as ResumeId, judgement: judgement() })
      )
      expect((foreign as { _tag: string })._tag).toBe("NotFound")
    })
  })

  /* ------------------------------------------------------------------------ */
  /* Schedule kind                                                            */
  /* ------------------------------------------------------------------------ */

  describe("fit schedule", () => {
    test("the fit kind fills the inference queue and records what it enqueued", async () => {
      const { tenant, vacancies } = await setup("fit-schedule", [90, 70])
      const created = await support.scheduleUpsert(tenant.userId, {
        kind: "fit",
        targetId: "global",
        intervalMinutes: 60,
        options: { limit: 1 }
      })
      expect(created.kind).toBe("fit")

      const idleRunner = Layer.succeed(CrawlRunner, {
        run: () => Effect.die("a fit schedule must not crawl")
      })
      const { outcomes, runs } = await support.runAsWithRunner(
        tenant.userId,
        idleRunner,
        Effect.gen(function*() {
          const outcomes = yield* runDueSchedules({ now: new Date(Date.now() + 3_600_000) })
          const schedules = yield* ScheduleService
          return { outcomes, runs: (yield* schedules.runs({ limit: 20 })).items }
        })
      )

      expect(outcomes.find((o) => o.scheduleId === created.id)).toMatchObject({ ok: true, error: null })
      const run = runs.find((r) => r.scheduleId === created.id)!
      expect(run.kind).toBe("fit")
      expect(run.detail).toMatchObject({ enqueued: 1, remaining: 1 })

      const pending = await fit(tenant.userId, (s) => s.list({ status: "pending" }))
      expect(pending.map((row) => row.vacancyId)).toEqual([vacancies[0]] as Array<VacancyId>)
    })
  })
}
