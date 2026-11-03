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
import * as support from "./support.ts"

const enabled = support.integrationEnabled
const serverUrl = support.serverUrl

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "../../../hh/test/fixtures", name), "utf8")

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
    const setup = async (label: string, state: "draft" | "queued" = "draft") => {
      const tenant = await support.seedTenant(label)
      const vacancyId = await support.seedVacancy(label)
      const externalId = await support.vacancyExternalId(vacancyId)
      const applicationId = await support.seedApplication({
        userId: tenant.userId,
        accountId: tenant.accountId,
        vacancyId,
        state
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
      expect(leased.job?.stage).toBe("prepare")
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

      // The attempt journal keeps the evidence, not the page body.
      const attempt = view.attempts.find((item) => item.stage === "prepare")
      expect(attempt?.exit?.tag).toBe("prepared")
      expect(JSON.stringify(attempt?.exit)).not.toContain("RESPONSE_MODAL_FORM_ID")
    })

    test("prepare on a responded page skips; on a login page asks for a human", async () => {
      const responded = await setup("prep-responded")
      await prepare(responded, '<div data-qa="responded-success-attach-cover-letter">Вы откликнулись</div>')
      expect(await stateOf(responded)).toBe("skipped")

      const login = await setup("prep-login")
      const result = await prepare(login, "<html></html>", 1, "https://hh.ru/account/login")
      expect(result.status).toBe("needs_human")
      expect(await stateOf(login)).toBe("needs_human")

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

    test("a code task is never approved from a model answer", async () => {
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
      const refused = await support.applicationApproveFailure(ctx.tenant.userId, ctx.applicationId)
      expect(refused).toBeInstanceOf(AnswersInvalid)
      expect((refused as AnswersInvalid).problems.map((problem) => problem.code)).toContain(
        "code_needs_human"
      )

      // The same answer written by a human is accepted.
      await support.applicationSetKit(ctx.tenant.userId, {
        applicationId: ctx.applicationId,
        formHash: form.formHash,
        letter: "x",
        answers: [human(other.id, { text: "5" }), human(code.id, { text: "def f(): pass" })]
      })
      const approved = await support.applicationApprove(ctx.tenant.userId, ctx.applicationId)
      expect(approved.state).toBe("queued")
    })

    test("an auto-mode application waits for a kit and queues its submit when one arrives", async () => {
      const ctx = await setup("auto-kit", "queued")
      await prepare(ctx, responseHtml)
      expect(await stateOf(ctx)).toBe("queued")
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(0)

      const form = (await detail(ctx)).form!.form
      await support.applicationSetKit(ctx.tenant.userId, {
        applicationId: ctx.applicationId,
        formHash: form.formHash,
        answers: [human("387049547", { optionIds: ["387049548"] })]
      })
      // Incomplete: still no submit.
      expect(await support.countJobs(ctx.applicationId, "submit")).toBe(0)

      await support.applicationSetKit(ctx.tenant.userId, {
        applicationId: ctx.applicationId,
        formHash: form.formHash,
        letter: "x",
        answers: fullAnswers()
      })
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

      // Reconcile finding the response settles it.
      const queued = (await support.jobsOf(ctx.applicationId)).find((row) => row.stage === "reconcile")!
      await support.makeJobRunnable(queued.id as string)
      const reconcile = await ctx.lease()
      expect(reconcile.job?.stage).toBe("reconcile")
      await ctx.complete(reconcile.job!, { tag: "submitted" })
      expect(await stateOf(ctx)).toBe("submitted")
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
      expect(await support.countJobs(ctx.applicationId, "reconcile")).toBe(0)
      expect((await support.findJob(job.id))?.result).toMatchObject({ clicked: false })

      // Retry is a new prepare, not a reconcile.
      await support.applicationRetry(ctx.tenant.userId, ctx.applicationId)
      expect(await support.countJobs(ctx.applicationId, "prepare")).toBe(2)
      expect(await support.countJobs(ctx.applicationId, "reconcile")).toBe(0)
      // The new form needs a new approval.
      expect(await stateOf(ctx)).toBe("draft")

      // The site changed a question: the new form has a new hash.
      const changed = responseHtml.replace("В каком городе проживаете?", "В какой стране проживаете?")
      const prepared = await ctx.lease()
      expect(prepared.job?.stage).toBe("prepare")
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
      const late = await support
        .completeJobFailure(ctx.tenant.userId, {
          harnessId: ctx.harness.id,
          token: ctx.harness.token!,
          jobId: job.id,
          leaseId: job.leaseId!,
          epoch: job.leaseEpoch,
          exit: { tag: "submitted", artifacts: successEvidence(ctx.externalId) }
        })
        .catch((error) => error)
      expect(await stateOf(ctx)).toBe("submitting")
      expect(late).toBeDefined()
    })

    test("one browser job per hh account at a time", async () => {
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
      // The same harness asks again while the first job is in flight.
      const second = await ctx.lease()
      expect(second.job).toBeNull()

      await ctx.complete(first.job!, { tag: "session_expired" })
      await support.makeJobRunnable((await support.jobsOf(otherApp))[0]!.id as string)
      const next = await ctx.lease()
      expect(next.job).not.toBeNull()
      expect(next.job?.id).not.toBe(first.job?.id)
    })
  })
}
