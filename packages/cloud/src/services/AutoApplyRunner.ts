import type {
  ApiError,
  ApplyFilterRecord,
  FormAnswer,
  ResponseForm,
  StoredForm,
  UserId
} from "@otbor/contract"
import { InferenceResult as InferenceResultSchema } from "@otbor/contract"
import {
  ANALYSIS_PROMPT_VERSION,
  APPLY_POLICY_VERSION,
  checkTextStyle,
  parseGeneratedDraft
} from "@otbor/domain"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Database, type Executor } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as ApplyFilterRepository from "../repositories/ApplyFilterRepository.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import * as VacancyFormRepository from "../repositories/VacancyFormRepository.ts"
import { DRAFT_PROMPT_VERSION } from "../writing/prompts.ts"
import { ApplicationService } from "./ApplicationService.ts"
import { checkKit, type KitProblem } from "./applyRules.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { inferenceJob } from "./jobs.ts"
import { sha256, toStorageError } from "./support.ts"
import { currentFormFor, requestFormRead } from "./vacancyForm.ts"
import { WritingService } from "./WritingService.ts"

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

export interface AutoApplyRunOptions {
  /** Only this hh account. Left out: every account of the user. */
  readonly hhAccountId?: string
}

/** Safe, JSON-shaped counts of one pass; they become `schedule_run.detail`. */
export interface AutoApplyResult {
  /** Accounts that had at least one row with `auto_mode != off`. */
  readonly accounts: number
  /** Decisions picked for a new application. */
  readonly selected: number
  readonly created: number
  /** Writing jobs queued (one per application and form hash). */
  readonly writingEnqueued: number
  /** Kits stored from a finished writing job. */
  readonly kitsSet: number
  /** Auto applications whose single submit job is queued now. */
  readonly submitQueued: number
  /** Applications parked for a human in this pass, with the reason in `last_error`. */
  readonly needsHuman: number
  /** Applications still waiting for a form read, a writing job or a slot. */
  readonly waiting: number
  readonly errors: ReadonlyArray<string>
}

export interface AutoApplyRunnerShape {
  /**
   * One idempotent pass for `userId`. Takes the user explicitly because the
   * worker runs schedules for their owner, not for the process-wide
   * `CurrentUser`.
   */
  readonly run: (
    userId: string,
    options?: AutoApplyRunOptions
  ) => Effect.Effect<AutoApplyResult, ApiError>
}

const describeError = (error: ApiError): string =>
  String((error as { readonly message?: unknown }).message ?? error._tag)

/** Applications the runner looks at per account and pass. */
const PROGRESS_LIMIT = 200

type Mode = "drafts" | "auto"

/** The idempotency key of the one writing job of (application, form). */
export const writingKey = (applicationId: string, formHash: string): string =>
  `autoapply:writing:${applicationId}:${formHash}`

/** What happened to one application in a pass. */
type Step =
  | { readonly tag: "waiting" }
  | { readonly tag: "idle" }
  | { readonly tag: "writing_enqueued" }
  | { readonly tag: "kit_set"; readonly submitQueued: boolean }
  | { readonly tag: "needs_human"; readonly reason: string }
  /** `setKit` already parked it (daily cap) and wrote the reason. */
  | { readonly tag: "parked" }

const waiting: Step = { tag: "waiting" }
const idle: Step = { tag: "idle" }
const human = (reason: string): Step => ({ tag: "needs_human", reason: reason.slice(0, 500) })

const describeProblems = (problems: ReadonlyArray<KitProblem>): string =>
  `kit refused: ${problems.map((problem) => problem.code).join(", ")}`

const hasContent = (hint: {
  readonly optionIds?: ReadonlyArray<string> | undefined
  readonly text?: string | undefined
}): boolean => (hint.optionIds?.length ?? 0) > 0 || (hint.text ?? "").trim() !== ""

/**
 * The kit answers of a finished draft. A hard hint is the answer (the model may
 * not rewrite it); a soft hint fills a question the model skipped. Everything
 * the model said is marked `model`, so `checkKit` still refuses code tasks.
 */
export const kitAnswers = (
  stored: StoredForm,
  draft: ReturnType<typeof parseGeneratedDraft>
): ReadonlyArray<FormAnswer> => {
  const hints = new Map(stored.hints.map((hint) => [hint.questionId, hint]))
  const modelled = new Map(draft.answers.map((answer) => [answer.questionId, answer]))
  const answers: Array<FormAnswer> = []
  for (const question of stored.form.questions) {
    const hint = hints.get(question.id)
    const usableHint = hint !== undefined && hint.blockers.length === 0 && hasContent(hint)
    const model = modelled.get(question.id)
    if (usableHint && (hint.hard || model === undefined)) {
      answers.push({
        questionId: question.id,
        ...(hint.optionIds === undefined ? {} : { optionIds: hint.optionIds }),
        ...(hint.text === undefined ? {} : { text: hint.text }),
        source: "hint",
        hard: hint.hard,
        needsHuman: false,
        evidence: hint.evidence
      })
      continue
    }
    if (model !== undefined) {
      answers.push({
        questionId: question.id,
        ...(model.optionIds === undefined ? {} : { optionIds: model.optionIds }),
        ...(model.text === undefined ? {} : { text: model.text }),
        source: "model",
        hard: false,
        needsHuman: false
      })
    }
  }
  return answers
}

/**
 * Reasons that make a model call pointless: the form can never be sent without
 * a person, whatever the model writes.
 */
const blockedBeforeWriting = (stored: StoredForm): string | null => {
  const form: ResponseForm = stored.form
  if (form.layout !== "known") return "the form layout was not recognized; a human must fill it in"
  const code = form.questions.find((question) => question.kind === "code")
  if (code !== undefined) return `a code question needs a human answer (${code.id})`
  const blocked = stored.hints.find((hint) => hint.blockers.length > 0)
  if (blocked !== undefined) {
    return `the answer hint is blocked (${blocked.questionId}): ${blocked.blockers.join(", ")}`
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

interface RunnerApplication {
  readonly id: string
  readonly vacancyId: string
  readonly resumeId: string | null
  readonly hhAccountId: string
  readonly autoRun: Mode
}

/**
 * `apply` schedule: turns the apply filter's `auto_mode` into applications.
 *
 * A pass has two halves. First it creates applications for the best current
 * `apply` decisions of every account row that is not `off` (bounded by
 * `batch_size` and the day's remaining budget). Then it moves the applications
 * it created along, one durable step at a time: read the form, queue one
 * writing job per (application, form hash), store the kit when the job is done,
 * and park the application for a human when the form or the kit needs one.
 * State is read from the database on every pass, so a crashed or overlapping
 * pass loses nothing, and every step has an idempotency key.
 *
 * The runner never changes the submit path: `ApplicationService.setKit` queues
 * the single submit of a `queued` application whose kit passes `checkKit` and
 * the daily cap. Applications without `auto_run` (made by hand) are never read.
 */
export class AutoApplyRunner extends Context.Service<AutoApplyRunner, AutoApplyRunnerShape>()(
  "otbor/cloud/AutoApplyRunner"
) {
  static readonly layer = Layer.effect(
    AutoApplyRunner,
    Effect.gen(function*() {
      const database = yield* Database

      /** ApplicationService and WritingService speak as `CurrentUser`; the runner speaks as the schedule owner. */
      const servicesFor = (userId: string) =>
        Layer.mergeAll(ApplicationService.layer, WritingService.layer).pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(CurrentUser, CurrentUser.of({ userId: userId as UserId }))
            )
          ),
          Layer.orDie
        )

      const run: AutoApplyRunnerShape["run"] = (userId, options = {}) =>
        Effect.gen(function*() {
          const applications = yield* ApplicationService
          const writing = yield* WritingService

          const counts = {
            accounts: 0,
            selected: 0,
            created: 0,
            writingEnqueued: 0,
            kitsSet: 0,
            submitQueued: 0,
            needsHuman: 0,
            waiting: 0
          }
          const errors: Array<string> = []
          const pushError = (message: string) => {
            if (errors.length < 5) errors.push(message)
          }

          const rows = yield* database
            .asUser(userId, (tx) => ApplyFilterRepository.listForUser(tx, userId, options.hhAccountId ?? null))
            .pipe(Effect.mapError(toStorageError("autoApply.filters")))
          const byAccount = new Map<string, Array<ApplyFilterRecord>>()
          for (const row of rows) {
            byAccount.set(row.hhAccountId, [...(byAccount.get(row.hhAccountId) ?? []), row])
          }

          /* ---------------------------------------------------------------- */
          /* One application                                                   */
          /* ---------------------------------------------------------------- */

          const parkForHuman = (applicationId: string, reason: string) =>
            database
              .asUser(userId, (tx) =>
                ApplicationRepository.transition(tx, userId, applicationId, "needs_human", {
                  from: ["queued", "draft"],
                  patch: { lastError: reason }
                })
              )
              .pipe(Effect.mapError(toStorageError("autoApply.park")), Effect.asVoid)

          /**
           * The resume a letter is written from: the application's own, else the
           * account's active one (hh picks the default resume for a response
           * without one), else the only resume.
           */
          const resumeForLetter = (tx: Executor, app: RunnerApplication) =>
            app.resumeId !== null
              ? Effect.succeed(app.resumeId)
              : tx
                  .execute(sql`
                    select id from resume
                    where user_id = ${userId} and hh_account_id = ${app.hhAccountId}
                    order by is_active desc, updated_at desc
                    limit 1
                  `)
                  .pipe(
                    Effect.map((result) => (result.rows[0] as { id?: string } | undefined)?.id ?? null)
                  )

          const progress = (app: RunnerApplication): Effect.Effect<Step, ApiError> =>
            Effect.gen(function*() {
              const snapshot = yield* database
                .asUser(userId, (tx) =>
                  Effect.gen(function*() {
                    const current = yield* ApplicationRepository.findAny(tx, app.id)
                    if (current === null || current.userId !== userId) return null
                    const form = yield* VacancyFormRepository.getState(tx, current.vacancyId)
                    const stored = yield* currentFormFor(tx, current)
                    const kit =
                      stored === null
                        ? null
                        : yield* ApplicationRepository.findKit(tx, app.id, stored.form.formHash)
                    const job =
                      stored === null || kit !== null
                        ? null
                        : yield* QueueRepository.findByKey(tx, writingKey(app.id, stored.form.formHash))
                    const submit = yield* QueueRepository.latestFor(tx, app.id, ["submit"])
                    return { current, form, stored, kit, job, submit }
                  })
                )
                .pipe(Effect.mapError(toStorageError("autoApply.snapshot")))

              if (snapshot === null) return idle
              const { current, form, stored, kit, job, submit } = snapshot

              // Only the two states the runner owns; a person changed anything else.
              const mine =
                (app.autoRun === "auto" && current.state === "queued") ||
                (app.autoRun === "drafts" && current.state === "draft")
              if (!mine) return idle
              // A submit job exists: the submit path owns it from here.
              if (submit !== null) return idle

              /* The form must be read and fresh before anything is written. */
              if (form.reading) return waiting
              if (form.lastError !== null) {
                return human(`the response form could not be read: ${form.lastError}`)
              }
              if (form.status === "gone") {
                return human("the vacancy no longer takes responses (the response form is gone)")
              }
              if (stored === null || form.stale) {
                if (stored === null && !form.stale) {
                  return human("the response form is not available")
                }
                // Reuses a read that is already queued; never forced.
                yield* database
                  .asUser(userId, (tx) =>
                    requestFormRead(tx, {
                      userId,
                      hhAccountId: current.hhAccountId,
                      vacancyId: current.vacancyId,
                      priority: 0
                    })
                  )
                  .pipe(Effect.mapError(toStorageError("autoApply.formRead")))
                return waiting
              }

              /* A kit for the current form: judge it, never write a second one. */
              if (kit !== null) {
                const problems = checkKit({ form: stored.form, hints: stored.hints, kit })
                if (problems.length > 0) return human(describeProblems(problems))
                if (app.autoRun === "drafts") return idle
                // Auto, kit passes, no submit yet: store it again so setKit's
                // own guard (daily cap, at-most-one submit) queues the submit.
                yield* applications.setKit({
                  applicationId: app.id,
                  formHash: kit.formHash,
                  letter: kit.letter ?? null,
                  answers: kit.answers,
                  model: kit.model ?? null,
                  promptHash: kit.promptHash ?? null,
                  costUsd: kit.costUsd ?? null
                })
                return yield* settle(app)
              }

              const blocked = blockedBeforeWriting(stored)
              if (blocked !== null) return human(blocked)

              /* No kit yet: one writing job per (application, form hash). */
              if (job === null) {
                const resumeId = yield* database
                  .asUser(userId, (tx) => resumeForLetter(tx, app))
                  .pipe(Effect.mapError(toStorageError("autoApply.resume")))
                if (resumeId === null) {
                  return human("there is no resume to write the cover letter from")
                }
                const prompt = yield* writing.draftPrompt({
                  vacancyId: current.vacancyId,
                  hhAccountId: current.hhAccountId,
                  resumeId
                })
                yield* database
                  .asUser(userId, (tx) =>
                    inferenceJob(tx, {
                      userId,
                      hhAccountId: current.hhAccountId,
                      payload: { prompt: prompt.user, system: prompt.system },
                      idempotencyKey: writingKey(app.id, stored.form.formHash)
                    })
                  )
                  .pipe(Effect.mapError(toStorageError("autoApply.enqueue")))
                return { tag: "writing_enqueued" } as const
              }

              if (job.status === "pending" || job.status === "leased" || job.status === "running") {
                return waiting
              }
              if (job.status !== "done") {
                return human(`the writing job ${job.status}; no letter was produced`)
              }

              const decoded = Schema.decodeUnknownOption(InferenceResultSchema)(job.result)
              if (Option.isNone(decoded) || decoded.value.text.trim() === "") {
                return human("the writing job finished without a text")
              }
              const draft = parseGeneratedDraft(decoded.value.text, stored.form.questions)
              if (draft.letter === null && draft.answers.length === 0 && draft.problems.length > 0 &&
                draft.problems.some((problem) => problem.includes("did not return JSON"))) {
                return human("the writing result is not a JSON draft")
              }
              const letter = stored.form.coverLetter === "absent" ? null : draft.letter
              if (letter !== null) {
                const style = [...new Set(checkTextStyle(letter).map((violation) => violation.code))]
                if (style.length > 0) return human(`the cover letter breaks the house style: ${style.join(", ")}`)
              }
              const payload = job.payload as { prompt?: unknown; system?: unknown } | null
              yield* applications.setKit({
                applicationId: app.id,
                formHash: stored.form.formHash,
                letter,
                answers: kitAnswers(stored, draft),
                model: decoded.value.model ?? null,
                promptHash: sha256(
                  `${DRAFT_PROMPT_VERSION}\n${String(payload?.system ?? "")}\n${String(payload?.prompt ?? "")}`
                ),
                costUsd: null
              })
              return yield* settle(app)
            })

          /**
           * After a kit was stored: a kit that fails `checkKit` parks the
           * application; an auto application reports whether `setKit` queued
           * the submit (it may instead have parked it on the daily cap).
           */
          const settle = (app: RunnerApplication): Effect.Effect<Step, ApiError> =>
            Effect.gen(function*() {
              const after = yield* database
                .asUser(userId, (tx) =>
                  Effect.gen(function*() {
                    const current = yield* ApplicationRepository.findAny(tx, app.id)
                    if (current === null) return null
                    const stored = yield* currentFormFor(tx, current)
                    const kit =
                      stored === null
                        ? null
                        : yield* ApplicationRepository.findKit(tx, app.id, stored.form.formHash)
                    const submit = yield* QueueRepository.latestFor(tx, app.id, ["submit"])
                    return { current, stored, kit, submit }
                  })
                )
                .pipe(Effect.mapError(toStorageError("autoApply.settle")))
              if (after === null || after.stored === null || after.kit === null) return idle
              if (after.current.state === "needs_human") return { tag: "parked" } as const
              const problems = checkKit({ form: after.stored.form, hints: after.stored.hints, kit: after.kit })
              if (problems.length > 0) return human(describeProblems(problems))
              return { tag: "kit_set", submitQueued: after.submit !== null } as const
            })

          const advance = (app: RunnerApplication) =>
            progress(app).pipe(
              Effect.flatMap((step): Effect.Effect<Step, ApiError> =>
                step.tag === "needs_human"
                  ? parkForHuman(app.id, step.reason).pipe(Effect.as(step))
                  : Effect.succeed(step)
              ),
              Effect.tap((step) => {
                switch (step.tag) {
                  case "waiting":
                    counts.waiting += 1
                    return Effect.void
                  case "writing_enqueued":
                    counts.writingEnqueued += 1
                    return Effect.logInfo(`autoapply ${app.id}: writing job queued`)
                  case "kit_set":
                    counts.kitsSet += 1
                    if (step.submitQueued) counts.submitQueued += 1
                    return Effect.logInfo(
                      `autoapply ${app.id}: kit stored${step.submitQueued ? ", submit queued" : ""}`
                    )
                  case "needs_human":
                    counts.needsHuman += 1
                    return Effect.logInfo(`autoapply ${app.id}: needs a human: ${step.reason}`)
                  case "parked":
                    counts.needsHuman += 1
                    return Effect.logInfo(`autoapply ${app.id}: parked by the daily cap`)
                  default:
                    return Effect.void
                }
              }),
              Effect.catch((error: ApiError) => {
                const message = `${app.id}: ${describeError(error)}`
                pushError(message)
                return Effect.logWarning(`autoapply ${message}`)
              })
            )

          /* ---------------------------------------------------------------- */
          /* One account                                                       */
          /* ---------------------------------------------------------------- */

          const processAccount = (hhAccountId: string, accountRows: ReadonlyArray<ApplyFilterRecord>) =>
            Effect.gen(function*() {
            const active = accountRows.filter((row) => row.autoMode !== "off")
            // Nothing is read or sent for an account without a row that is on.
            if (active.length === 0) return
            counts.accounts += 1

            const pairResumeIds = accountRows.flatMap((row) => (row.resumeId === null ? [] : [row.resumeId]))
            // A pair row decides for its resume; the account row for the rest.
            const modeOf = (resumeId: string | null): ApplyFilterRecord["autoMode"] => {
              const pair = resumeId === null ? undefined : accountRows.find((row) => row.resumeId === resumeId)
              const own = pair ?? accountRows.find((row) => row.resumeId === null)
              return own?.autoMode ?? "off"
            }

            // Creation: pair rows first (they are the more specific), then the account row.
            const ordered = [...active].sort((a, b) => Number(a.resumeId === null) - Number(b.resumeId === null))
            for (const row of ordered) {
              const mode = row.autoMode as Mode
              const budget = yield* Effect.gen(function*() {
                const usage = yield* applications.dailyUsage(hhAccountId)
                // Auto applications waiting for their kit will take a slot each.
                const pending = yield* database
                  .asUser(userId, (tx) =>
                    tx
                      .execute(sql`
                        select count(*)::int as n from application
                        where user_id = ${userId} and hh_account_id = ${hhAccountId}
                          and auto_run = 'auto' and state = 'queued' and intent_at is null
                      `)
                      .pipe(Effect.map((result) => Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0)))
                  )
                  .pipe(Effect.mapError(toStorageError("autoApply.pending")))
                return usage.remaining - (mode === "auto" ? pending : 0)
              })
              if (budget <= 0) continue
              const limit = Math.min(row.batchSize, budget)

              const candidates = yield* database
                .asUser(userId, (tx) =>
                  DecisionRepository.autoApplyCandidates(tx, userId, {
                    hhAccountId,
                    resumeId: row.resumeId,
                    excludeResumeIds: row.resumeId === null ? pairResumeIds : [],
                    minPriority: row.minPriority,
                    sort: row.sort,
                    limit,
                    policyVersion: APPLY_POLICY_VERSION,
                    analysisPromptVersion: ANALYSIS_PROMPT_VERSION
                  })
                )
                .pipe(Effect.mapError(toStorageError("autoApply.select")))
              counts.selected += candidates.length

              for (const decision of candidates) {
                const made = yield* applications
                  .createFromDecision({
                    decisionId: decision.id,
                    hhAccountId,
                    ...(decision.resumeId === null || decision.resumeId === undefined
                      ? {}
                      : { resumeId: decision.resumeId }),
                    mode,
                    autoRun: true
                  })
                  .pipe(Effect.result)
                if (made._tag === "Failure") {
                  const error = made.failure
                  pushError(`${decision.id}: ${describeError(error)}`)
                  continue
                }
                counts.created += 1
              }
            }

            // Progress: everything the runner created that still waits on it.
            const owned = yield* database
              .asUser(userId, (tx) =>
                tx
                  .execute(sql`
                    select id, vacancy_id, resume_id, hh_account_id, auto_run
                    from application
                    where user_id = ${userId} and hh_account_id = ${hhAccountId}
                      and auto_run is not null
                      and ((auto_run = 'auto' and state = 'queued' and intent_at is null)
                        or (auto_run = 'drafts' and state = 'draft'
                          and not exists (select 1 from application_kit k where k.application_id = application.id)))
                    order by created_at asc
                    limit ${PROGRESS_LIMIT}
                  `)
                  .pipe(
                    Effect.map((result) =>
                      (
                        result.rows as unknown as ReadonlyArray<{
                          id: string
                          vacancy_id: string
                          resume_id: string | null
                          hh_account_id: string
                          auto_run: Mode
                        }>
                      ).map(
                        (row): RunnerApplication => ({
                          id: row.id,
                          vacancyId: row.vacancy_id,
                          resumeId: row.resume_id,
                          hhAccountId: row.hh_account_id,
                          autoRun: row.auto_run
                        })
                      )
                    )
                  )
              )
              .pipe(Effect.mapError(toStorageError("autoApply.owned")))

            for (const app of owned) {
              // The mode may have changed since the application was made: only
              // an application whose row is still in the mode it was made in moves on.
              if (modeOf(app.resumeId) !== app.autoRun) continue
              yield* advance(app)
            }
            })

          // One account failing (a missing account, a database error) must not stop the others.
          for (const [hhAccountId, accountRows] of byAccount) {
            yield* processAccount(hhAccountId, accountRows).pipe(
              Effect.catch((error: ApiError) => {
                const message = `account ${hhAccountId}: ${describeError(error)}`
                pushError(message)
                return Effect.logWarning(`autoapply ${message}`)
              })
            )
          }

          if (counts.created + counts.writingEnqueued + counts.kitsSet + counts.needsHuman > 0 || errors.length > 0) {
            yield* Effect.logInfo(
              `autoapply: ${counts.created} created, ${counts.writingEnqueued} writing, ` +
                `${counts.kitsSet} kits, ${counts.submitQueued} submits, ${counts.needsHuman} need a human`
            )
          }
          return { ...counts, errors } satisfies AutoApplyResult
        }).pipe(Effect.provide(servicesFor(userId)))

      return AutoApplyRunner.of({ run })
    })
  )
}
