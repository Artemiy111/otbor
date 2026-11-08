/**
 * The browser apply flow against a real Postgres: prepare stores the form,
 * approve validates the kit, submit is decided from evidence and is never
 * repeated. No hh.ru: pages are the local fixtures of packages/hh.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { AnswersInvalid, Conflict, type FormAnswer, type HarnessExit } from "@otbor/contract"
import { parseResponseForm } from "@otbor/hh"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as support from "./support/index.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "../../../hh/test/fixtures", name), "utf8")

// Synthetic, hand-written reconcile pages (see packages/hh/test/negotiations.test.ts).
const vacancyOpenHtml = fixture("synthetic-vacancy-open.html")
const vacancyRespondedHtml = fixture("synthetic-vacancy-responded.html")
const emptyListHtml = fixture("synthetic-negotiations-empty.html")
const otherListHtml =
  '<template id="HH-Lux-InitialState">{"applicantNegotiations":{"topicList":[{"vacancyId":777,"lastState":"RESPONSE"}]}}</template>'

const responseHtml = fixture("hh-test-response.html")
const codeHtml = fixture("hh-test-code.html")

const urlFor = (externalId: string) =>
  `https://hh.ru/applicant/vacancy_response?vacancyId=${externalId}`

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

const successEvidence = (externalId: string) => ({
  clicked: true,
  url: urlFor(externalId),
  marker: "success",
  html: '<div data-qa="responded-success-attach-cover-letter">Вы откликнулись</div>'
})

if (!enabled || serverUrl === null) {
  test("apply-browser integration suite is opt-in (OTBOR_TEST_DATABASE_URL)", () => {
    expect(enabled).toBe(false)
  })
} else {
  const base = serverUrl
  const previousDatabaseUrl = process.env.DATABASE_URL

  describe("browser apply flow", () => {
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

    /** A tenant with one account, a registered browser harness and one application. */
    const setup = async (label: string, state: "draft" | "preparing" | "queued" = "draft", autoRun?: "auto") => {
      const tenant = await support.seedTenant(label)
      if (autoRun === "auto") {
        await support.applyFilterSet(tenant.userId, { hhAccountId: tenant.accountId, filter: {}, autoMode: "auto" })
      }
      const vacancyId = await support.seedVacancy(label)
      const externalId = await support.vacancyExternalId(vacancyId)
      const applicationId = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        state,
        ...(autoRun === undefined ? {} : { autoRun })
      })
      const harness = await support.registerHarness(tenant.userId, [tenant.accountId])
      const lease = () =>
        support.leaseNext(tenant.userId, harness.id, harness.token!, [tenant.accountId])
      const complete = (
        job: NonNullable<Awaited<ReturnType<typeof lease>>["job"]>,
        exit: HarnessExit
      ) =>
        support.completeJob(tenant.userId, {
          harnessId: harness.id,
          token: harness.token!,
          jobId: job.id,
          leaseId: job.leaseId!,
          epoch: job.leaseEpoch,
          exit
        })
      return { tenant, vacancyId, externalId, applicationId, harness, lease, complete }
    }

    type Ctx = Awaited<ReturnType<typeof setup>>

    /** Enqueue, lease and complete a prepare job with the given page. */
    const prepare = async (ctx: Ctx, html: string, sequence = 1, url = urlFor(ctx.externalId)) => {
      await support.enqueuePrepareJob({
        userId: ctx.tenant.userId,
        accountId: ctx.tenant.accountId,
        applicationId: ctx.applicationId,
        vacancyId: ctx.vacancyId,
        externalId: ctx.externalId,
        sequence
      })
      const leased = await ctx.lease()
      expect(leased.job?.stage).toBe("form_read")
      return ctx.complete(leased.job!, { tag: "prepared", artifacts: { url, html } })
    }

    const detail = (ctx: Ctx) => support.applicationGet(ctx.tenant.userId, ctx.applicationId)

    const stateOf = async (ctx: Ctx) => (await support.findApplication(ctx.applicationId))?.state

    /** Prepare, set a full kit and approve. Returns the leased submit job. */
    const readyToSubmit = async (ctx: Ctx) => {
      await prepare(ctx, responseHtml)
      const form = (await detail(ctx)).form!.form
      await support.applicationSetKit(ctx.tenant.userId, {
        applicationId: ctx.applicationId,
        formHash: form.formHash,
        letter: "Здравствуйте",
        answers: fullAnswers()
      })
      await support.applicationApprove(ctx.tenant.userId, ctx.applicationId)
      const leased = await ctx.lease()
      expect(leased.job?.stage).toBe("submit")
      return { job: leased.job!, formHash: form.formHash }
    }

    test("prepare parses the page in the cloud and stores the form, hints and no kit", async () => {
      const ctx = await setup("prep-form")
      const result = await prepare(ctx, responseHtml)
      expect(result).toMatchObject({ accepted: true, status: "done" })

      const view = await detail(ctx)
      expect(view.form?.form.layout).toBe("known")
      expect(view.form?.form.questions).toHaveLength(5)
      expect(view.form?.form.formHash).toBe(
        parseResponseForm(responseHtml, urlFor(ctx.externalId)).formHash
      )
      expect(Array.isArray(view.form?.hints)).toBe(true)
      expect(view.kit ?? null).toBeNull()

      // Nothing is queued for submit until a kit exists and is approved.
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(0)
      expect(await stateOf(ctx)).toBe("draft")

      // The form belongs to the vacancy: the same version is visible without the application.
      const shared = await support.vacancyFormState(ctx.tenant.userId, ctx.vacancyId)
      expect(shared).toMatchObject({ status: "present", stale: false, reading: false, versions: 1 })
      expect(shared.form?.formHash).toBe(view.form?.form.formHash)
    })

    test("an edited form becomes a new version; a day-old form is not approved", async () => {
      const ctx = await setup("form-versions")
      await prepare(ctx, responseHtml)
      const first = await support.vacancyFormState(ctx.tenant.userId, ctx.vacancyId)

      // A second read of the same form adds no version.
      await prepare(ctx, responseHtml)
      expect((await support.vacancyFormState(ctx.tenant.userId, ctx.vacancyId)).versions).toBe(1)

      // The employer edits a question: a new version, the old one is kept.
      const changed = responseHtml.replace("В каком городе проживаете?", "В какой стране проживаете?")
      await prepare(ctx, changed)
      const second = await support.vacancyFormState(ctx.tenant.userId, ctx.vacancyId)
      expect(second.versions).toBe(2)
      expect(second.form?.formHash).not.toBe(first.form?.formHash)

      // An old read is not trusted for an irreversible send.
      await support.applicationSetKit(ctx.tenant.userId, {
        applicationId: ctx.applicationId,
        formHash: second.form!.formHash,
        letter: "Здравствуйте",
        answers: fullAnswers()
      })
      await support.ageVacancyForm(ctx.vacancyId, 25)
      expect((await support.vacancyFormState(ctx.tenant.userId, ctx.vacancyId)).stale).toBe(true)
      await expect(support.applicationApprove(ctx.tenant.userId, ctx.applicationId)).rejects.toThrow()
    })

    test("prepare on a responded page skips; on a login page asks for a human", async () => {
      const responded = await setup("prep-responded")
      await prepare(responded, '<div data-qa="responded-success-attach-cover-letter">Вы откликнулись</div>')
      // A draft is the operator's; only an auto-queued application is parked by a failed read.
      expect(await stateOf(responded)).toBe("draft")
      const respondedForm = await support.vacancyFormState(responded.tenant.userId, responded.vacancyId)
      // the skip reason is kept, so the vacancy does not look like a form with no questions
      expect(respondedForm.lastError).toContain("already holds a response")
      expect(respondedForm.form).toBeNull()

      const auto = await setup("prep-responded-auto", "preparing")
      await prepare(auto, '<div data-qa="responded-success-attach-cover-letter">Вы откликнулись</div>')
      expect(await stateOf(auto)).toBe("skipped")

      const login = await setup("prep-login")
      const result = await prepare(login, "<html></html>", 1, "https://hh.ru/account/login")
      expect(result.status).toBe("needs_human")
      expect(await stateOf(login)).toBe("draft")

      const relocation = await setup("prep-reloc")
      await support.enqueuePrepareJob({
        userId: relocation.tenant.userId,
        accountId: relocation.tenant.accountId,
        applicationId: relocation.applicationId,
        vacancyId: relocation.vacancyId,
        externalId: relocation.externalId
      })
      const leased = await relocation.lease()
      const done = await relocation.complete(leased.job!, { tag: "relocation_warning" })
      expect(done.status).toBe("needs_human")
    })

    test("a form of another vacancy is not stored", async () => {
      const ctx = await setup("prep-wrong")
      const result = await prepare(ctx, responseHtml, 1, urlFor("999"))
      expect(result.status).toBe("needs_human")
      expect((await detail(ctx)).form ?? null).toBeNull()
    })

    test("approve refuses without a form, without a kit and with an invalid kit", async () => {
      const ctx = await setup("approve-refuse")
      const first = await support.applicationApproveFailure(ctx.tenant.userId, ctx.applicationId)
      expect(first).toBeInstanceOf(Conflict)

      await prepare(ctx, responseHtml)
      const form = (await detail(ctx)).form!.form
      const second = await support.applicationApproveFailure(ctx.tenant.userId, ctx.applicationId)
      expect(second).toBeInstanceOf(Conflict)

      // Required questions unanswered: typed AnswersInvalid.
      await support.applicationSetKit(ctx.tenant.userId, {
        applicationId: ctx.applicationId,
        formHash: form.formHash,
        letter: "x",
        answers: [human("387049547", { optionIds: ["387049548"] })]
      })
      const refused = await support.applicationApproveFailure(ctx.tenant.userId, ctx.applicationId)
      expect(refused).toBeInstanceOf(AnswersInvalid)
      expect((refused as AnswersInvalid).problems.map((problem) => problem.code)).toContain(
        "required_unanswered"
      )
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(0)
      expect(await stateOf(ctx)).toBe("draft")

      // A kit written for a different form does not count as a kit.
      const other = await setup("approve-stale")
      await prepare(other, responseHtml)
      await support.applicationSetKit(other.tenant.userId, {
        applicationId: other.applicationId,
        formHash: "stale-hash",
        letter: "x",
        answers: fullAnswers()
      })
      const stale = await support.applicationApproveFailure(other.tenant.userId, other.applicationId)
      expect(stale).toBeInstanceOf(Conflict)
    })

    test("a code task answered by the model is approved like any other answer", async () => {
      const ctx = await setup("approve-code")
      await prepare(ctx, codeHtml)
      const form = (await detail(ctx)).form!.form
      const code = form.questions.find((question) => question.kind === "code")!
      const other = form.questions.find((question) => question.kind !== "code")!

      await support.applicationSetKit(ctx.tenant.userId, {
        applicationId: ctx.applicationId,
        formHash: form.formHash,
        letter: "x",
        answers: [
          human(other.id, { text: "5" }),
          human(code.id, { text: "def f(): pass", source: "model" })
        ]
      })
      const approved = await support.applicationApprove(ctx.tenant.userId, ctx.applicationId)
      expect(approved.state).toBe("queued")
    })

    test("an auto-mode application waits for a kit and queues its submit when one arrives", async () => {
      const ctx = await setup("auto-kit", "preparing", "auto")
      await prepare(ctx, responseHtml)
      expect(await stateOf(ctx)).toBe("preparing")
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(0)

      const form = (await detail(ctx)).form!.form
      await support.applicationSetKit(ctx.tenant.userId, {
        applicationId: ctx.applicationId,
        formHash: form.formHash,
        answers: [human("387049547", { optionIds: ["387049548"] })]
      })
      // Incomplete: still no submit.
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(0)

      const complete = {
        applicationId: ctx.applicationId,
        formHash: form.formHash,
        letter: "x",
        answers: fullAnswers()
      }
      // Оператор (RPC, без опции раннера) кит сохраняет, но не отправляет.
      await support.applicationSetKit(ctx.tenant.userId, complete)
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(0)
      expect(await stateOf(ctx)).toBe("preparing")
      // Раннер сохраняет тот же кит и отправляет через шлюз.
      await support.applicationSetKit(ctx.tenant.userId, complete, { runner: true })
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(1)
    })

    test("the submit job carries the form hash and structured answers; leasing writes the intent", async () => {
      const ctx = await setup("intent")
      const { job, formHash } = await readyToSubmit(ctx)

      const payload = job.payload as {
        expectedFormHash: string
        externalId: string
        kit: { formHash: string; answers: ReadonlyArray<FormAnswer>; letter: string | null }
      }
      expect(payload.expectedFormHash).toBe(formHash)
      expect(payload.externalId).toBe(ctx.externalId)
      expect(payload.kit.answers).toHaveLength(5)
      expect(payload.kit.answers[0]).toHaveProperty("questionId")

      // The intent exists before the harness did anything: the application is
      // submitting and the attempt journal has an open submit row.
      expect(await stateOf(ctx)).toBe("submitting")
      const view = await detail(ctx)
      const open = view.attempts.find((attempt) => attempt.stage === "submit")
      expect(open).toBeDefined()
      expect(open?.exit ?? null).toBeNull()
      expect(open?.finishedAt ?? null).toBeNull()
    })

    test("page evidence of success settles the submit without a reconcile", async () => {
      const ctx = await setup("evidence")
      const { job } = await readyToSubmit(ctx)

      const result = await ctx.complete(job, {
        tag: "submitted",
        artifacts: successEvidence(ctx.externalId)
      })
      expect(result).toMatchObject({ accepted: true, status: "done" })
      expect(await stateOf(ctx)).toBe("submitted")
      expect((await support.findApplication(ctx.applicationId))?.submittedAt).not.toBeNull()
      expect(await support.countJobs(ctx.applicationId, "reconcile")).toBe(0)

      // The page body is not kept on the attempt, only an excerpt.
      const attempt = (await detail(ctx)).attempts.find((item) => item.stage === "submit")
      expect(attempt?.exit?.tag).toBe("submitted")

      // And it cannot be approved or retried into a second submit.
      const again = await support.applicationApproveFailure(ctx.tenant.userId, ctx.applicationId)
      expect(again).toBeInstanceOf(Conflict)
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(1)
    })

    test("submitted without page evidence is parked in reconcile and never resubmitted", async () => {
      const ctx = await setup("no-evidence")
      const { job } = await readyToSubmit(ctx)

      const result = await ctx.complete(job, { tag: "submitted" })
      expect(result.status).toBe("needs_reconcile")
      expect(await stateOf(ctx)).toBe("submitting")
      expect(await support.countJobs(ctx.applicationId, "reconcile")).toBe(1)

      const approve = await support.applicationApproveFailure(ctx.tenant.userId, ctx.applicationId)
      expect(approve).toBeInstanceOf(Conflict)
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(1)
    })

    test("an ambiguous result after the click goes to reconcile", async () => {
      const ctx = await setup("ambiguous")
      const { job } = await readyToSubmit(ctx)

      const result = await ctx.complete(job, {
        tag: "ambiguous",
        message: "hh did not confirm",
        artifacts: { clicked: true, url: urlFor(ctx.externalId), marker: "none" }
      })
      expect(result.status).toBe("needs_reconcile")
      expect(await stateOf(ctx)).toBe("submitting")
      expect(await support.countJobs(ctx.applicationId, "reconcile")).toBe(1)
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(1)

      // Retry on a submitting application is refused: reconcile, never resubmit.
      await expect(support.applicationRetry(ctx.tenant.userId, ctx.applicationId)).rejects.toBeDefined()
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(1)

      // A reconcile that merely claims "submitted" proves nothing.
      const reconcile = await leaseReconcile(ctx)
      const claim = await ctx.complete(reconcile, { tag: "submitted" })
      expect(claim.status).toBe("pending")
      expect(await stateOf(ctx)).toBe("submitting")
    })

    /** Makes the application's pending reconcile job runnable and leases it. */
    const leaseReconcile = async (ctx: Ctx) => {
      const queued = (await support.jobsOf(ctx.applicationId)).find(
        (row) => row.stage === "reconcile" && row.status === "pending"
      )!
      await support.makeJobRunnable(queued.id as string)
      const leased = await ctx.lease()
      expect(leased.job?.stage).toBe("reconcile")
      return leased.job!
    }

    const vacancyPage = (ctx: Ctx, responded: boolean) => ({
      url: `https://hh.ru/vacancy/${ctx.externalId}`,
      html: responded ? vacancyRespondedHtml : vacancyOpenHtml
    })

    const reconciled = (
      ctx: Ctx,
      read: {
        vacancy?: { url: string; html: string }
        negotiations: ReadonlyArray<string>
      }
    ): HarnessExit => ({
      tag: "reconciled",
      artifacts: {
        externalId: ctx.externalId,
        ...(read.vacancy === undefined ? {} : { vacancy: read.vacancy }),
        negotiations: read.negotiations.map((html, index) => ({
          url: `https://hh.ru/applicant/negotiations?page=${index}`,
          html
        }))
      }
    })

    /** A list page that holds this vacancy (as `externalId`), or other ones. */
    const listWith = (ctx: Ctx) =>
      `<template id="HH-Lux-InitialState">{"applicantNegotiations":{"topicList":[{"vacancyId":${JSON.stringify(ctx.externalId)},"lastState":"RESPONSE"}]}}</template>`

    /** An ambiguous submit, parked in reconcile. Returns the leased reconcile job. */
    const ambiguousSubmit = async (ctx: Ctx) => {
      const { job } = await readyToSubmit(ctx)
      await ctx.complete(job, {
        tag: "ambiguous",
        message: "timeout after the click",
        artifacts: { clicked: true, url: urlFor(ctx.externalId), marker: "none" }
      })
      expect(await stateOf(ctx)).toBe("submitting")
      return leaseReconcile(ctx)
    }

    test("reconcile finding the response on the vacancy page settles submitted", async () => {
      const ctx = await setup("rec-vacancy")
      const job = await ambiguousSubmit(ctx)

      const result = await ctx.complete(
        job,
        reconciled(ctx, { vacancy: vacancyPage(ctx, true), negotiations: [listWith(ctx)] })
      )
      expect(result).toMatchObject({ accepted: true, status: "done" })
      expect(await stateOf(ctx)).toBe("submitted")
      expect((await support.findApplication(ctx.applicationId))?.submittedAt).not.toBeNull()

      // The parked submit is closed and the journal holds the reading, not the pages.
      const submit = (await support.jobsOf(ctx.applicationId)).find((row) => row.stage === "submit")!
      expect(submit.status).toBe("done")
      const attempt = (await detail(ctx)).attempts.find((item) => item.stage === "reconcile")
      expect(JSON.stringify(attempt)).not.toContain("HH-Lux-InitialState")
      expect(JSON.stringify(attempt)).toContain("submitted")

      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(1)
      const again = await support.applicationApproveFailure(ctx.tenant.userId, ctx.applicationId)
      expect(again).toBeInstanceOf(Conflict)
    })

    test("reconcile finding the response only in the negotiations list settles submitted", async () => {
      const ctx = await setup("rec-list")
      const job = await ambiguousSubmit(ctx)
      await ctx.complete(job, reconciled(ctx, { negotiations: [listWith(ctx)] }))
      expect(await stateOf(ctx)).toBe("submitted")
    })

    test("reconcile proving no response returns the application to draft; one approval then allows one new submit", async () => {
      const ctx = await setup("rec-unsent")
      const job = await ambiguousSubmit(ctx)

      const result = await ctx.complete(
        job,
        reconciled(ctx, {
          vacancy: vacancyPage(ctx, false),
          negotiations: [otherListHtml, emptyListHtml]
        })
      )
      expect(result).toMatchObject({ accepted: true, status: "done" })
      expect(await stateOf(ctx)).toBe("draft")

      // Nothing was queued on its own: no new submit, no further reconcile.
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(1)
      const rows = await support.jobsOf(ctx.applicationId)
      expect(rows.filter((row) => row.stage === "reconcile" && row.status === "pending")).toHaveLength(0)
      const submit = rows.find((row) => row.stage === "submit")!
      expect(submit.status).toBe("failed")
      expect(submit.result).toMatchObject({ clicked: false })

      // A person approves again: exactly one new submit, and then no third.
      await support.applicationApprove(ctx.tenant.userId, ctx.applicationId)
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(2)
      const second = await ctx.lease()
      expect(second.job?.stage).toBe("submit")
      await ctx.complete(second.job!, { tag: "submitted", artifacts: successEvidence(ctx.externalId) })
      expect(await stateOf(ctx)).toBe("submitted")
      const third = await support.applicationApproveFailure(ctx.tenant.userId, ctx.applicationId)
      expect(third).toBeInstanceOf(Conflict)
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(2)
    })

    test("an inconclusive reconcile retries a bounded number of times and then needs a human, never a second submit", async () => {
      const ctx = await setup("rec-inconclusive")
      let job = await ambiguousSubmit(ctx)

      // The list was not read to the end: absence proves nothing.
      for (let attempt = 1; attempt < 3; attempt += 1) {
        const result = await ctx.complete(
          job,
          reconciled(ctx, { vacancy: vacancyPage(ctx, false), negotiations: [otherListHtml] })
        )
        expect(result.status).toBe("pending")
        expect(await stateOf(ctx)).toBe("submitting")
        const row = (await support.jobsOf(ctx.applicationId)).find((item) => item.stage === "reconcile")!
        await support.makeJobRunnable(row.id as string)
        const leased = await ctx.lease()
        expect(leased.job?.stage).toBe("reconcile")
        job = leased.job!
      }
      const last = await ctx.complete(
        job,
        reconciled(ctx, { vacancy: vacancyPage(ctx, false), negotiations: [otherListHtml] })
      )
      expect(last.status).toBe("dead")
      expect(await stateOf(ctx)).toBe("needs_human")

      // The submit job is still parked; approving is refused and a retry only reconciles again.
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(1)
      expect(await support.applicationApproveFailure(ctx.tenant.userId, ctx.applicationId)).toBeInstanceOf(Conflict)
      await support.applicationRetry(ctx.tenant.userId, ctx.applicationId)
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(1)
      expect(await support.countJobs(ctx.applicationId, "reconcile")).toBe(2)
      expect(await stateOf(ctx)).toBe("submitting")
    })

    test("a contradictory reconcile stays in reconcile", async () => {
      const ctx = await setup("rec-contradiction")
      const job = await ambiguousSubmit(ctx)
      const result = await ctx.complete(
        job,
        reconciled(ctx, { vacancy: vacancyPage(ctx, false), negotiations: [listWith(ctx)] })
      )
      expect(result.status).toBe("pending")
      expect(await stateOf(ctx)).toBe("submitting")
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(1)
    })

    test("reconcile hitting a login page needs a human and queues nothing", async () => {
      const ctx = await setup("rec-login")
      const job = await ambiguousSubmit(ctx)
      const result = await ctx.complete(job, { tag: "session_expired" })
      expect(result.status).toBe("needs_human")
      expect(await stateOf(ctx)).toBe("needs_human")
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(1)
    })

    test("an expired submit lease is reconciled the same way and never resubmitted", async () => {
      const ctx = await setup("rec-expired")
      const { job } = await readyToSubmit(ctx)
      await support.expireJobLease(job.id)
      await support.recoverExpiredJobs()
      expect(await stateOf(ctx)).toBe("submitting")

      const reconcile = await leaseReconcile(ctx)
      await ctx.complete(
        reconcile,
        reconciled(ctx, { vacancy: vacancyPage(ctx, false), negotiations: [emptyListHtml] })
      )
      expect(await stateOf(ctx)).toBe("draft")
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(1)
    })

    test("form_changed before the click is not sent; a fresh prepare allows exactly one new submit", async () => {
      const ctx = await setup("form-changed")
      const { job } = await readyToSubmit(ctx)

      const result = await ctx.complete(job, {
        tag: "form_changed",
        formHash: "new-hash",
        artifacts: { clicked: false, url: urlFor(ctx.externalId), marker: "none" }
      })
      expect(result).toMatchObject({ accepted: true, status: "needs_human" })
      expect(await stateOf(ctx)).toBe("needs_human")
      expect((await support.findApplication(ctx.applicationId))?.blockedReason).toBe("submit_not_sent")
      expect(await support.countJobs(ctx.applicationId, "reconcile")).toBe(0)
      expect((await support.findJob(job.id))?.result).toMatchObject({ clicked: false })

      // Retry is a new prepare, not a reconcile.
      await support.applicationRetry(ctx.tenant.userId, ctx.applicationId)
      expect((await support.formReadJobsOf(ctx.vacancyId)).length).toBe(2)
      expect(await support.countJobs(ctx.applicationId, "reconcile")).toBe(0)
      // The new form needs a new approval.
      expect(await stateOf(ctx)).toBe("draft")
      expect((await support.findApplication(ctx.applicationId))?.blockedReason).toBeNull()

      // The site changed a question: the new form has a new hash.
      const changed = responseHtml.replace("В каком городе проживаете?", "В какой стране проживаете?")
      const prepared = await ctx.lease()
      expect(prepared.job?.stage).toBe("form_read")
      await ctx.complete(prepared.job!, {
        tag: "prepared",
        artifacts: { url: urlFor(ctx.externalId), html: changed }
      })
      const newForm = (await detail(ctx)).form!.form
      expect(newForm.formHash).not.toBe(job.payload && (job.payload as { expectedFormHash: string }).expectedFormHash)

      // The old kit does not match the new form.
      const stale = await support.applicationApproveFailure(ctx.tenant.userId, ctx.applicationId)
      expect(stale).toBeInstanceOf(Conflict)

      await support.applicationSetKit(ctx.tenant.userId, {
        applicationId: ctx.applicationId,
        formHash: newForm.formHash,
        letter: "x",
        answers: fullAnswers()
      })
      await support.applicationApprove(ctx.tenant.userId, ctx.applicationId)
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(2)

      // The second submit goes through and then nothing can add a third.
      const second = await ctx.lease()
      expect(second.job?.stage).toBe("submit")
      await ctx.complete(second.job!, {
        tag: "submitted",
        artifacts: successEvidence(ctx.externalId)
      })
      expect(await stateOf(ctx)).toBe("submitted")
      const third = await support.applicationApproveFailure(ctx.tenant.userId, ctx.applicationId)
      expect(third).toBeInstanceOf(Conflict)
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(2)
    })

    test("a pre-click tag without the clicked: false evidence is not believed", async () => {
      const ctx = await setup("unproven")
      const { job } = await readyToSubmit(ctx)
      const result = await ctx.complete(job, { tag: "form_changed" })
      expect(result.status).toBe("needs_reconcile")
      expect(await support.countJobs(ctx.applicationId, "reconcile")).toBe(1)
    })

    test("a submit whose lease expires becomes needs_reconcile, never pending", async () => {
      const ctx = await setup("expired-submit")
      const { job } = await readyToSubmit(ctx)

      await support.expireJobLease(job.id)
      const recovered = await support.recoverExpiredJobs()
      expect(recovered).toContain(job.id)

      expect((await support.findJob(job.id))?.status).toBe("needs_reconcile")
      expect(await stateOf(ctx)).toBe("submitting")
      expect(await support.countJobs(ctx.applicationId, "reconcile")).toBe(1)
      const attempt = (await detail(ctx)).attempts.find((item) => item.stage === "submit")
      expect(attempt?.exit?.tag).toBe("ambiguous")

      // A late completion from the dead performer is a stale lease.
      let late: unknown
      try {
        late = await support.completeJobFailure(ctx.tenant.userId, {
          harnessId: ctx.harness.id,
          token: ctx.harness.token!,
          jobId: job.id,
          leaseId: job.leaseId!,
          epoch: job.leaseEpoch,
          exit: { tag: "submitted", artifacts: successEvidence(ctx.externalId) }
        })
      } catch (error) {
        late = error
      }
      expect(await stateOf(ctx)).toBe("submitting")
      expect(late).toBeDefined()
    })

    test("browser jobs of one account run side by side for one harness", async () => {
      const ctx = await setup("serial")
      const otherVacancy = await support.seedVacancy("serial-2")
      const otherApp = await support.seedApplication({
        userId: ctx.tenant.userId,
        accountId: ctx.tenant.accountId,
        vacancyId: otherVacancy,
        state: "draft"
      })

      await support.enqueuePrepareJob({
        userId: ctx.tenant.userId,
        accountId: ctx.tenant.accountId,
        applicationId: ctx.applicationId,
        vacancyId: ctx.vacancyId,
        externalId: ctx.externalId
      })
      await support.enqueuePrepareJob({
        userId: ctx.tenant.userId,
        accountId: ctx.tenant.accountId,
        applicationId: otherApp,
        vacancyId: otherVacancy,
        externalId: await support.vacancyExternalId(otherVacancy)
      })

      const first = await ctx.lease()
      expect(first.job).not.toBeNull()
      // The same harness asks again while the first job is in flight: reads
      // of one account go in parallel up to the cloud cap.
      const second = await ctx.lease()
      expect(second.job).not.toBeNull()
      expect(second.job?.id).not.toBe(first.job?.id)
      expect((await ctx.lease()).job).toBeNull()
    })
  })
}
