import type {
  ApiError,
  ApplicationRecord,
  BlockedReason,
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
  parseGeneratedDraft
} from "@otbor/domain"
import { Config, Context, Effect, Layer, Match, Option, Schema } from "effect"
import { Database, type Executor } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as ApplyFilterRepository from "../repositories/ApplyFilterRepository.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import * as VacancyFormRepository from "../repositories/VacancyFormRepository.ts"
import { DRAFT_PROMPT_VERSION } from "../writing/prompts.ts"
import { ApplicationService } from "./ApplicationService.ts"
import { deferOrPark, retireWritingJob } from "./blocked.ts"
import { NO_RESUME_MESSAGE, resolveApplyResume } from "./applyResume.ts"
import { checkKit, type KitProblem } from "./applyRules.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { runnerMayAdvance } from "./autoRunMode.ts"
import { DEFAULT_DAILY_APPLY_LIMIT } from "./dailyLimit.ts"
import { trySubmit } from "./submitGate.ts"
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
  /**
   * Двигает дальше только перечисленные автозаявки, не создавая новых: тот же
   * шаг, что делает проход (режим строки, `retry_at`), но сразу после того, как
   * закончилась задача, которую заявка ждала (чтение формы, письмо). Вызывать
   * после коммита завершения задачи; расписание остаётся запасным путём.
   */
  readonly advance: (
    userId: string,
    applicationIds: ReadonlyArray<string>
  ) => Effect.Effect<AutoApplyResult, ApiError>
}

const describeError = (error: ApiError): string =>
  String((error as { readonly message?: unknown }).message ?? error._tag)

/** Applications the runner looks at per account and pass. */
const PROGRESS_LIMIT = 200

type Mode = "drafts" | "auto"

/** Режим, который сейчас ведёт заявку с этим резюме (парная строка, иначе строка аккаунта). */
type ModeOf = (resumeId: string | null) => ApplyFilterRecord["autoMode"]

/**
 * The idempotency key of the one writing job of (application, form). A dead job
 * gives the key up (`<key>:retried:<n>`) when it is retried, so the next job
 * takes the plain key again.
 */
export const writingKey = (applicationId: string, formHash: string): string =>
  `autoapply:writing:${applicationId}:${formHash}`

/** Id заявки из ключа задачи письма; `null`, если ключ не `autoapply:writing:`. */
export const writingApplicationId = (idempotencyKey: string): string | null => {
  const parts = idempotencyKey.split(":")
  return parts[0] === "autoapply" && parts[1] === "writing" && parts[2] !== undefined && parts[2] !== ""
    ? parts[2]
    : null
}

/** What happened to one application in a pass. */
type Step =
  | { readonly tag: "waiting" }
  | { readonly tag: "idle" }
  | { readonly tag: "writing_enqueued" }
  | { readonly tag: "kit_set"; readonly submitQueued: boolean }
  | { readonly tag: "needs_human"; readonly reason: string; readonly code: BlockedReason }
  /** Транзиентный сбой исчерпал автоповторы: заявка уже у человека с кодом. */
  | { readonly tag: "parked" }

const waiting: Step = { tag: "waiting" }
const idle: Step = { tag: "idle" }
const human = (reason: string, code: BlockedReason): Step => ({
  tag: "needs_human",
  reason: reason.slice(0, 500),
  code
})

const describeProblems = (problems: ReadonlyArray<KitProblem>): string =>
  `kit refused: ${problems.map((problem) => problem.code).join(", ")}`

const hasContent = (hint: {
  readonly optionIds?: ReadonlyArray<string> | undefined
  readonly text?: string | undefined
}): boolean => (hint.optionIds?.length ?? 0) > 0 || (hint.text ?? "").trim() !== ""

/**
 * The kit answers of a finished draft. A hard hint is the answer (the model may
 * not rewrite it); a soft hint fills a question the model skipped. Everything
 * the model said is marked `model`,.
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
const blockedBeforeWriting = (stored: StoredForm): { readonly reason: string; readonly code: BlockedReason } | null => {
  const form: ResponseForm = stored.form
  if (form.layout !== "known") {
    return { reason: "the form layout was not recognized; a human must fill it in", code: "form_unreadable" }
  }
  const blocked = stored.hints.find((hint) => hint.blockers.length > 0)
  if (blocked !== undefined) {
    return {
      reason: `the answer hint is blocked (${blocked.questionId}): ${blocked.blockers.join(", ")}`,
      code: "form_hint_blocked"
    }
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

type RunnerApplication = ApplicationRepository.RunnerApplicationRow

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
 * Отправку runner не решает сам: единственную submit-задачу `queued` автозаявки
 * с подходящим китом ставит общий шлюз `trySubmit` (режим auto, свежая форма,
 * `checkKit`, дневной лимит). Applications without `auto_run` (made by hand) are never read.
 */
export class AutoApplyRunner extends Context.Service<AutoApplyRunner, AutoApplyRunnerShape>()(
  "otbor/cloud/AutoApplyRunner"
) {
  /** Продовый слой: лимит по умолчанию - `OTBOR_DAILY_APPLY_LIMIT` (иначе 200). */
  static readonly layer = Layer.unwrap(
    Config.Int("OTBOR_DAILY_APPLY_LIMIT").pipe(
      Config.withDefault(DEFAULT_DAILY_APPLY_LIMIT),
      Effect.map((dailyApplyLimit) => AutoApplyRunner.layerWith({ dailyApplyLimit }))
    )
  )

  static readonly layerWith = (config: { readonly dailyApplyLimit: number }) =>
  Layer.effect(
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

      /**
       * Проход раннера. С `only` создание заявок пропускается, а двигаются
       * только перечисленные заявки (остальные условия выбора прежние).
       */
      const pass = (
        userId: string,
        options: AutoApplyRunOptions,
        only?: ReadonlyArray<string>
      ): Effect.Effect<AutoApplyResult, ApiError> =>
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

          const parkForHuman = (applicationId: string, reason: string, code: BlockedReason) =>
            database
              .asUser(userId, (tx) =>
                ApplicationRepository.transition(tx, userId, applicationId, "needs_human", {
                  from: ["preparing", "draft"],
                  patch: { lastError: reason, blockedReason: code }
                })
              )
              .pipe(Effect.mapError(toStorageError("autoApply.park")), Effect.asVoid)

          /**
           * An auto application that was made before the resume was resolved
           * (resume_id NULL): sets the resolved resume, guarded by the unique index
           * (account, vacancy, resume). Only `auto_run` rows, only while still NULL.
           * Returns the effective resume id, or a reason to park it.
           */
          const backfillResume = (app: RunnerApplication) =>
            database
              .asUser(userId, (tx) =>
                Effect.gen(function*() {
                  const resume = yield* resolveApplyResume(tx, userId, app.hhAccountId, null)
                  if (resume === null) return { reason: NO_RESUME_MESSAGE, resumeId: null }
                  const clash = yield* ApplicationRepository.resumeClashExists(tx, {
                    hhAccountId: app.hhAccountId,
                    vacancyId: app.vacancyId,
                    resumeId: resume.id,
                    exceptId: app.id
                  })
                  if (clash) {
                    return {
                      reason: `не выбрано резюме для откликов: на эту вакансию уже есть отклик резюме «${resume.title}»`,
                      resumeId: null
                    }
                  }
                  yield* ApplicationRepository.backfillResume(tx, { userId, id: app.id, resumeId: resume.id })
                  return { reason: null, resumeId: resume.id }
                })
              )
              .pipe(Effect.mapError(toStorageError("autoApply.resume")))

          /**
           * Транзиентный сбой: автоотклик остаётся `preparing` и ждёт повтор;
           * когда автоповторы кончились - он у человека с тем же кодом.
           */
          const transient = (
            app: RunnerApplication,
            current: ApplicationRecord,
            code: BlockedReason,
            message: string
          ): Effect.Effect<Step, ApiError> =>
            // Черновик (`drafts`) повторов не получает: письмо и форма ждут человека сразу.
            app.autoRun === "drafts"
              ? Effect.succeed(human(message, code))
              : database
                  .asUser(userId, (tx) => deferOrPark(tx, userId, current, code, message.slice(0, 500)))
                  .pipe(
                    Effect.mapError(toStorageError("autoApply.defer")),
                    Effect.map((outcome): Step => (outcome === "deferred" ? waiting : { tag: "parked" }))
                  )

          const progress = (app: RunnerApplication, modeOf: ModeOf): Effect.Effect<Step, ApiError> =>
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
                    // Why a writing job failed (the harness message) goes into the human reason.
                    const jobError =
                      job === null || job.status === "done"
                        ? null
                        : yield* QueueRepository.lastErrorOf(tx, job.id)
                    const submit = yield* QueueRepository.latestFor(tx, app.id, ["submit"])
                    // Срок ожидания проверяем по часам базы в той же транзакции: список
                    // заявок и этот снимок - разные транзакции, а соседний проход мог
                    // успеть отложить заявку заново.
                    const due = yield* ApplicationRepository.retryDue(tx, app.id)
                    return { current, form, stored, kit, job, jobError, submit, due }
                  })
                )
                .pipe(Effect.mapError(toStorageError("autoApply.snapshot")))

              if (snapshot === null) return idle
              const { current, form, stored, kit, jobError, submit, due } = snapshot
              let job = snapshot.job

              // Only the two states the runner owns; a person changed anything else.
              const mine =
                (app.autoRun === "auto" && current.state === "preparing") ||
                (app.autoRun === "drafts" && current.state === "draft")
              if (!mine) return idle
              // A submit job exists: the submit path owns it from here.
              if (submit !== null) return idle

              // Заявка ещё ждёт `retry_at` (дневной лимит, автоповтор): не трогаем.
              if (!due) return waiting

              /* One resume for the response and the letter: set it on old NULL rows. */
              let effectiveResumeId: string | null = current.resumeId ?? null
              if (effectiveResumeId === null) {
                const filled = yield* backfillResume(app)
                if (filled.reason !== null || filled.resumeId === null) {
                  return human(filled.reason ?? NO_RESUME_MESSAGE, "no_resume")
                }
                effectiveResumeId = filled.resumeId
              }
              // Режим мог смениться; решает строка, которая ведёт заявку с учётом
              // дозаполненного резюме, а не то, что было в строке до дозаполнения.
              if (!runnerMayAdvance(modeOf(effectiveResumeId), app.autoRun)) return idle

              /*
               * Заявка дождалась `retry_at` (иначе запрос её не отдал бы): причину
               * ожидания снимаем, раннер идёт дальше. Что именно ждало, помним для
               * повтора ниже.
               */
              const resumed = current.blockedReason ?? null
              if (resumed !== null) {
                // Условное снятие: если соседний проход успел отложить заявку заново,
                // срок ещё не вышел, и этот шаг - ожидание.
                const cleared = yield* database
                  .asUser(userId, (tx) => ApplicationRepository.clearPreparingBlock(tx, userId, app.id))
                  .pipe(Effect.mapError(toStorageError("autoApply.resume")))
                if (!cleared) return waiting
              }

              // Повтор письма: мёртвая задача отдаёт ключ, ниже ставится новая.
              if (resumed === "writing_failed" && job !== null && job.status !== "done" &&
                !(job.status === "pending" || job.status === "leased" || job.status === "running")) {
                const dead = job
                yield* database
                  .asUser(userId, (tx) => retireWritingJob(tx, app.id, dead.id))
                  .pipe(Effect.mapError(toStorageError("autoApply.retire")))
                job = null
              }

              /* The form must be read and fresh before anything is written. */
              if (form.reading) return waiting
              if (form.lastError !== null) {
                if (resumed === "form_read_failed") {
                  // Автоповтор: читаем форму заново, а не доверяем прошлому сбою.
                  yield* database
                    .asUser(userId, (tx) =>
                      requestFormRead(tx, {
                        userId,
                        hhAccountId: current.hhAccountId,
                        vacancyId: current.vacancyId,
                        force: true,
                        priority: 0
                      })
                    )
                    .pipe(Effect.mapError(toStorageError("autoApply.formRead")))
                  return waiting
                }
                // Сбой чтения оставил чужой аккаунт: у этого он такой же транзиентный.
                return yield* transient(
                  app,
                  current,
                  "form_read_failed",
                  `the response form could not be read: ${form.lastError}`
                )
              }
              if (form.status === "gone") {
                return human("the vacancy no longer takes responses (the response form is gone)", "form_gone")
              }
              if (stored === null || form.stale) {
                if (stored === null && !form.stale) {
                  return human("the response form is not available", "form_unreadable")
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
                if (problems.length > 0) return human(describeProblems(problems), "kit_refused")
                if (app.autoRun === "drafts") return idle
                // Автоотклик, кит проходит, submit ещё нет: отправку решает общий
                // шлюз (режим auto, свежесть формы, дневной лимит, at-most-once).
                const gate = yield* database
                  .asUser(userId, (tx) =>
                    trySubmit(tx, {
                      userId,
                      application: { ...current, resumeId: effectiveResumeId as ApplicationRecord["resumeId"] },
                      trigger: "auto",
                      fallbackLimit: config.dailyApplyLimit
                    })
                  )
                  .pipe(Effect.mapError(toStorageError("autoApply.submit")))
                return Match.value(gate).pipe(
                  Match.tagsExhaustive({
                    queued: (queued): Step => ({ tag: "kit_set", submitQueued: queued.jobQueued }),
                    // Дневной лимит: заявка осталась `preparing` с `retry_at`, шлюз всё записал.
                    parked: (): Step => waiting,
                    not_ready: (): Step => waiting,
                    refused: (refused): Step =>
                      refused.reason === "kit_refused"
                        ? human(describeProblems(refused.problems), "kit_refused")
                        : refused.reason === "no_vacancy"
                        ? human(refused.message, "operator")
                        : idle
                  })
                )
              }

              const blocked = blockedBeforeWriting(stored)
              if (blocked !== null) return human(blocked.reason, blocked.code)

              /* No kit yet: one writing job per (application, form hash). */
              if (job === null) {
                const resumeId = effectiveResumeId
                // The operator's writer (agent, model, effort) from the filter row
                // that governs this application; none set: the harness default.
                const writer = yield* database
                  .asUser(userId, (tx) =>
                    ApplyFilterRepository.resolve(tx, userId, current.hhAccountId, effectiveResumeId)
                  )
                  .pipe(Effect.mapError(toStorageError("autoApply.writer")))
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
                      payload: {
                        prompt: prompt.user,
                        system: prompt.system,
                        ...(writer.writingHarness === null ? {} : { harness: writer.writingHarness }),
                        ...(writer.writingModel === null ? {} : { model: writer.writingModel }),
                        ...(writer.writingEffort === null ? {} : { effort: writer.writingEffort })
                      },
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
                // Харнесс мог быть недоступен: письмо повторяется само (1 ч, 4 ч, 12 ч),
                // потом заявка уходит человеку с кодом writing_failed.
                return yield* transient(
                  app,
                  current,
                  "writing_failed",
                  `the writing job ${job.status}; no letter was produced${
                    jobError === null || jobError === "" ? "" : `: ${jobError}`
                  }`
                )
              }

              const decoded = Schema.decodeUnknownOption(InferenceResultSchema)(job.result)
              if (Option.isNone(decoded) || decoded.value.text.trim() === "") {
                return human("the writing job finished without a text", "writing_failed")
              }
              const draft = parseGeneratedDraft(decoded.value.text, stored.form.questions)
              if (draft.letter === null && draft.answers.length === 0 && draft.problems.length > 0 &&
                draft.problems.some((problem) => problem.includes("did not return JSON"))) {
                return human("the writing result is not a JSON draft", "writing_failed")
              }
              const letter = stored.form.coverLetter === "absent" ? null : draft.letter
              const payload = job.payload as { prompt?: unknown; system?: unknown } | null
              yield* applications.setKit(
                {
                  applicationId: app.id,
                  formHash: stored.form.formHash,
                  letter,
                  answers: kitAnswers(stored, draft),
                  model: decoded.value.model ?? null,
                  promptHash: sha256(
                    `${DRAFT_PROMPT_VERSION}\n${String(payload?.system ?? "")}\n${String(payload?.prompt ?? "")}`
                  ),
                  costUsd: null
                },
                { runner: true }
              )
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
              // Дневной лимит: кит есть, заявка ждёт слот в `preparing`.
              if (after.current.state === "preparing" && after.current.blockedReason === "daily_cap") return waiting
              const problems = checkKit({ form: after.stored.form, hints: after.stored.hints, kit: after.kit })
              if (problems.length > 0) return human(describeProblems(problems), "kit_refused")
              return { tag: "kit_set", submitQueued: after.submit !== null } as const
            })

          const advance = (app: RunnerApplication, modeOf: ModeOf) =>
            progress(app, modeOf).pipe(
              Effect.flatMap((step): Effect.Effect<Step, ApiError> =>
                step.tag === "needs_human"
                  ? parkForHuman(app.id, step.reason, step.code).pipe(Effect.as(step))
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
                    return Effect.logInfo(`autoapply ${app.id}: retries exhausted, needs a human`)
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
            const modeOf: ModeOf = (resumeId) => {
              const pair = resumeId === null ? undefined : accountRows.find((row) => row.resumeId === resumeId)
              const own = pair ?? accountRows.find((row) => row.resumeId === null)
              return own?.autoMode ?? "off"
            }

            // Creation: pair rows first (they are the more specific), then the account row.
            const ordered =
              only === undefined
                ? [...active].sort((a, b) => Number(a.resumeId === null) - Number(b.resumeId === null))
                : []
            for (const row of ordered) {
              const mode = row.autoMode as Mode
              const budget = yield* Effect.gen(function*() {
                const usage = yield* applications.dailyUsage(hhAccountId)
                // Auto applications waiting for their kit will take a slot each.
                const pending = yield* database
                  .asUser(userId, (tx) => ApplicationRepository.pendingAutoSlots(tx, userId, hhAccountId))
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
                    sortDirection: row.sortDirection,
                    limit,
                    policyVersion: APPLY_POLICY_VERSION,
                    analysisPromptVersion: ANALYSIS_PROMPT_VERSION
                  })
                )
                .pipe(Effect.mapError(toStorageError("autoApply.select")))
              counts.selected += candidates.length

              for (const decision of candidates) {
                const resolved = yield* database
                  .asUser(userId, (tx) => resolveApplyResume(tx, userId, hhAccountId, decision.resumeId ?? null))
                  .pipe(Effect.mapError(toStorageError("autoApply.resume")))
                const made = yield* applications
                  .createFromDecision({
                    decisionId: decision.id,
                    hhAccountId,
                    ...(resolved === null ? {} : { resumeId: resolved.id }),
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
                if (resolved === null && made.success.id !== undefined) {
                  // Never send with the resume hh happens to preselect.
                  yield* parkForHuman(made.success.id, NO_RESUME_MESSAGE, "no_resume")
                  counts.needsHuman += 1
                }
              }
            }

            // Progress: everything the runner created that still waits on it.
            const owned = yield* database
              .asUser(userId, (tx) =>
                ApplicationRepository.listOwnedByRunner(tx, {
                  userId,
                  hhAccountId,
                  limit: PROGRESS_LIMIT,
                  onlyIds: only
                })
              )
              .pipe(Effect.mapError(toStorageError("autoApply.owned")))

            for (const app of owned) {
              // Режим мог смениться с момента создания заявки: `auto` двигается, пока
              // строка `auto`; `drafts` (без отправки) - пока строка `drafts` или `auto`. У заявки без резюме проверка
              // идёт после дозаполнения резюме (в `progress`).
              if (app.resumeId !== null && !runnerMayAdvance(modeOf(app.resumeId), app.autoRun)) continue
              yield* advance(app, modeOf)
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

      const run: AutoApplyRunnerShape["run"] = (userId, options = {}) => pass(userId, options)

      const advance: AutoApplyRunnerShape["advance"] = (userId, applicationIds) =>
        applicationIds.length === 0
          ? Effect.succeed({
              accounts: 0,
              selected: 0,
              created: 0,
              writingEnqueued: 0,
              kitsSet: 0,
              submitQueued: 0,
              needsHuman: 0,
              waiting: 0,
              errors: []
            })
          : pass(userId, {}, applicationIds)

      return AutoApplyRunner.of({ run, advance })
    })
  )
}
