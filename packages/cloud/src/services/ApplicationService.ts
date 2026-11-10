import type {
  ApiError,
  ApplicationDetail,
  ApplicationId,
  ApplyUsage,
  ApplicationRecord,
  AutoApplyRetryResult,
  KitAnswer,
  KitRecord,
  VacancyFormState
} from "@otbor/contract"
import { AnswersInvalid, Conflict, InvalidInput, LimitExceeded, NotFound } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Config, Context, Data, Effect, Layer, Match } from "effect"
import { Database, type DatabaseError, type Executor } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as ApplyFilterRepository from "../repositories/ApplyFilterRepository.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { type KitProblem } from "./applyRules.ts"
import { DEFAULT_DAILY_APPLY_LIMIT, dailyLimitFor, recentSubmits } from "./dailyLimit.ts"

export { DEFAULT_DAILY_APPLY_LIMIT }
import { nextSequence, reconcileJob, targetFor } from "./jobs.ts"
import * as VacancyFormRepository from "../repositories/VacancyFormRepository.ts"
import { currentFormFor, requestFormRead } from "./vacancyForm.ts"
import { trySubmit } from "./submitGate.ts"
import { toStorageError } from "./support.ts"

/* -------------------------------------------------------------------------- */
/* Outcomes                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A transaction never fails with a product error: it returns an outcome. The
 * only failure the database boundary can add is `StorageError`, so the two
 * stay distinguishable in the logs.
 */
type Failure =
  | { readonly _tag: "not_found"; readonly entity: string; readonly id: string }
  | { readonly _tag: "conflict"; readonly entity: string; readonly message: string }
  | { readonly _tag: "invalid"; readonly message: string }
  | {
      readonly _tag: "answers"
      readonly applicationId: string
      readonly problems: ReadonlyArray<KitProblem>
    }
  | {
      readonly _tag: "limit"
      readonly limit: number
      readonly used: number
      readonly resetsAt: string
    }

type Outcome<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly failure: Failure }

const ok = <A>(value: A): Outcome<A> => ({ ok: true, value })
const fail = (failure: Failure): Outcome<never> => ({ ok: false, failure })

const raise: (failure: Failure) => ApiError = Match.type<Failure>().pipe(
  Match.tagsExhaustive({
    not_found: (failure) => new NotFound({ entity: failure.entity, id: failure.id }),
    conflict: (failure) => new Conflict({ entity: failure.entity, message: failure.message }),
    invalid: (failure) => new InvalidInput({ message: failure.message }),
    answers: (failure) =>
      new AnswersInvalid({
        applicationId: failure.applicationId,
        message: `the kit cannot be approved: ${failure.problems.map((problem) => problem.code).join(", ")}`,
        problems: failure.problems
      }),
    limit: (failure) => new LimitExceeded({ limit: failure.limit, used: failure.used, resetsAt: failure.resetsAt })
  })
)

/** Внутренний сигнал: исход - отказ, транзакцию надо откатить. */
class Refusal extends Data.TaggedError("Refusal")<{ readonly failure: Failure }> {}

const unwrap = <A>(outcome: Outcome<A>): Effect.Effect<A, ApiError> =>
  outcome.ok ? Effect.succeed(outcome.value) : Effect.fail(raise(outcome.failure))

/* -------------------------------------------------------------------------- */
/* Queue helpers                                                              */
/* -------------------------------------------------------------------------- */

const accountExists = (tx: Executor, id: string) =>
  tx
    .execute(sql`select id from hh_account where id = ${id} limit 1`)
    .pipe(Effect.map((result) => result.rows.length > 0))

const vacancyFor = (tx: Executor, id: string) => VacancyRepository.findById(tx, id)

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreateFromDecisionInput {
  readonly decisionId: string
  readonly hhAccountId: string
  readonly resumeId?: string
  /** Учитывается только вместе с `autoRun`: режим, в котором раннер ведёт заявку. */
  readonly mode?: "drafts" | "auto"
  /**
   * Set by AutoApplyRunner only: records on a newly created row that the runner
   * owns it. An application that already exists is never claimed.
   */
  readonly autoRun?: boolean
}

export interface CreateManualInput {
  readonly vacancyId: string
  readonly hhAccountId: string
  readonly resumeId?: string
}

/** Manual prepares jump the queue: the operator is waiting on this one. */
export const MANUAL_PREPARE_PRIORITY = 1000

export interface SetKitInput {
  readonly applicationId: string
  readonly formHash: string
  readonly letter?: string | null
  readonly answers?: ReadonlyArray<KitAnswer>
  readonly model?: string | null
  readonly promptHash?: string | null
  readonly costUsd?: number | null
}

export interface ApplicationServiceShape {
  readonly list: (options: {
    readonly state?: string
    readonly hhAccountId?: string
    readonly vacancyId?: string
    readonly limit?: number
  }) => Effect.Effect<ReadonlyArray<ApplicationRecord>, ApiError>
  readonly get: (id: string) => Effect.Effect<ApplicationDetail, ApiError>
  readonly createFromDecision: (
    input: CreateFromDecisionInput
  ) => Effect.Effect<ApplicationRecord, ApiError>
  /**
   * Manual mode: no decision, no policy. Same one-per-(account, vacancy) rule
   * and the same prepare job as `createFromDecision`; approve is unchanged.
   */
  readonly createManual: (
    input: CreateManualInput
  ) => Effect.Effect<{ readonly application: ApplicationRecord; readonly created: boolean }, ApiError>
  readonly approve: (id: string) => Effect.Effect<ApplicationRecord, ApiError>
  readonly skip: (input: { readonly id: string; readonly reason?: string }) => Effect.Effect<
    ApplicationRecord,
    ApiError
  >
  readonly retry: (id: string) => Effect.Effect<ApplicationRecord, ApiError>
  /** Повторяет заявки, остановленные капчей; те, что нельзя повторить, попадают в `skipped`. */
  readonly retryCaptcha: (input: {
    readonly hhAccountId?: string | undefined
  }) => Effect.Effect<AutoApplyRetryResult, ApiError>
  /**
   * Сохраняет кит. `options.runner` передаёт только AutoApplyRunner: тогда кит
   * `preparing`-автозаявки сразу идёт в шлюз отправки. Оператор через RPC опций
   * не передаёт, поэтому сохранение кита никогда не отправляет отклик.
   */
  readonly setKit: (
    input: SetKitInput,
    options?: { readonly runner?: boolean }
  ) => Effect.Effect<KitRecord, ApiError>
  /** Responses used and left in the rolling 24 hours of one hh account. */
  readonly dailyUsage: (hhAccountId: string) => Effect.Effect<ApplyUsage, ApiError>
  /** The response form of a vacancy as last read. Never opens hh. */
  readonly formGet: (vacancyId: string) => Effect.Effect<VacancyFormState, ApiError>
  /** Queues a form read when the stored form is stale (or with `force`). Creates no application. */
  readonly formRefresh: (input: {
    readonly vacancyId: string
    readonly hhAccountId: string
    readonly force?: boolean
  }) => Effect.Effect<VacancyFormState, ApiError>
}

export interface ApplicationServiceOptions {
  /**
   * Approvals allowed per hh account in any 24 hours when the account has no
   * apply filter row; a stored `apply_filter.daily_limit` (resume null) wins.
   */
  readonly dailyApplyLimit: number
}

const asInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null
const asString = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null)
const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

/** The writing job of an auto application (key of AutoApplyRunner.writingKey), read for the kit's page. */
const writingOf = (tx: Executor, applicationId: string, formHash: string) =>
  tx
    .execute(sql`
      select payload->>'harness' as harness, payload->>'model' as model, payload->>'effort' as effort,
        result, updated_at
      from harness_jobs
      where idempotency_key = ${`autoapply:writing:${applicationId}:${formHash}`} and status = 'done'
      limit 1
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as
          | { harness: string | null; model: string | null; effort: string | null; result: unknown; updated_at: Date | string }
          | undefined
        if (row === undefined) return null
        const out = asRecord(row.result)
        const usage = asRecord(out.usage)
        const quota = asRecord(asRecord(asRecord(out.providerResponse)._meta).quota)
        const modelUsage = quota["model_usage"]
        const firstModel = Array.isArray(modelUsage) ? asRecord(modelUsage[0]) : {}
        return {
          harness: row.harness,
          model: asString(out.model) ?? row.model,
          modelId: asString(firstModel.model),
          effort: asString(out.effort) ?? row.effort,
          inputTokens: asInt(usage.inputTokens),
          outputTokens: asInt(usage.outputTokens),
          cachedReadTokens: asInt(usage.cachedReadTokens),
          cachedWriteTokens: asInt(usage.cachedWriteTokens),
          totalTokens: asInt(usage.totalTokens),
          durationMs: asInt(out.durationMs),
          finishedAt: new Date(row.updated_at).toISOString()
        }
      })
    )

export class ApplicationService extends Context.Service<ApplicationService, ApplicationServiceShape>()(
  "otbor/cloud/ApplicationService"
) {
  /** Production layer: the default daily limit is `OTBOR_DAILY_APPLY_LIMIT` (default 200). */
  static readonly layer = Layer.unwrap(
    Config.Int("OTBOR_DAILY_APPLY_LIMIT").pipe(
      Config.withDefault(DEFAULT_DAILY_APPLY_LIMIT),
      Effect.map((dailyApplyLimit) => ApplicationService.layerWith({ dailyApplyLimit }))
    )
  )

  static readonly layerWith = (options: ApplicationServiceOptions) =>
  Layer.effect(
    ApplicationService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      /**
       * Транзакция с исходом-значением. Отказ (`fail(...)`) откатывает всё, что
       * транзакция успела записать до него, и возвращается наружу как значение:
       * иначе отклонённая операция оставляла бы частичные записи.
       */
      const asOutcome = <A>(body: (tx: Executor) => Effect.Effect<Outcome<A>, DatabaseError>) =>
        database
          .asUser(currentUser.userId, (tx) =>
            body(tx).pipe(
              Effect.flatMap((outcome) =>
                outcome.ok ? Effect.succeed(outcome) : Effect.fail(new Refusal({ failure: outcome.failure }))
              )
            )
          )
          .pipe(Effect.catchTag("Refusal", (refusal) => Effect.succeed(fail(refusal.failure))))

      const list: ApplicationServiceShape["list"] = (options) =>
        database
          .asUser(currentUser.userId, (tx) => ApplicationRepository.list(tx, currentUser.userId, options))
          .pipe(Effect.mapError(toStorageError("application.list")))

      const get: ApplicationServiceShape["get"] = (id) =>
        Effect.gen(function*() {
          const detail = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const base = yield* ApplicationRepository.find(tx, currentUser.userId, id)
                if (base === null) return null
                const decision =
                  base.application.decisionId === null ||
                  base.application.decisionId === undefined
                    ? null
                    : yield* DecisionRepository.findById(tx, base.application.decisionId)
                const form = yield* currentFormFor(tx, base.application)
                const writing = form === null || base.kit == null ? null : yield* writingOf(tx, id, base.kit.formHash)
                return { ...base, form, decision, writing } satisfies ApplicationDetail
              })
            )
            .pipe(Effect.mapError(toStorageError("application.get")))

          if (detail === null) {
            return yield* new NotFound({ entity: "Application", id })
          }
          return detail
        })

      const createFromDecision: ApplicationServiceShape["createFromDecision"] = (input) =>
        Effect.gen(function*() {
          const outcome = yield* asOutcome((tx) =>
              Effect.gen(function*() {
                const decision = yield* DecisionRepository.findById(tx, input.decisionId)
                if (decision === null) {
                  return fail({ _tag: "not_found", entity: "Decision", id: input.decisionId })
                }
                if (decision.userId !== currentUser.userId) {
                  return fail({ _tag: "not_found", entity: "Decision", id: input.decisionId })
                }
                if (decision.verdict === "skip") {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: "decision is a skip; there is nothing to apply to"
                  })
                }
                if (!(yield* accountExists(tx, input.hhAccountId))) {
                  return fail({ _tag: "not_found", entity: "HhAccount", id: input.hhAccountId })
                }

                const vacancy = yield* vacancyFor(tx, decision.vacancyId)
                if (vacancy === null) {
                  return fail({
                    _tag: "not_found",
                    entity: "Vacancy",
                    id: decision.vacancyId
                  })
                }

                if (vacancy.archived) {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: "the vacancy is archived; hh takes no responses"
                  })
                }

                // `preparing` заводит только раннер (autoRun): у заявки с auto_run
                // есть хозяин, который её ведёт. Любая другая создаёт `draft`.
                const runnerOwned = input.autoRun === true && input.mode !== undefined
                const state = runnerOwned && input.mode === "auto" ? "preparing" : "draft"
                const created = yield* ApplicationRepository.create(tx, {
                  userId: currentUser.userId,
                  hhAccountId: input.hhAccountId,
                  vacancyId: vacancy.id,
                  resumeId: input.resumeId ?? decision.resumeId ?? null,
                  streamId: null,
                  decisionId: decision.id,
                  state,
                  ...(runnerOwned ? { autoRun: input.mode } : {})
                })

                if (created.created) {
                  yield* requestFormRead(tx, {
                    userId: currentUser.userId,
                    hhAccountId: input.hhAccountId,
                    vacancyId: vacancy.id,
                    priority: Math.round(decision.priority)
                  })
                }

                return ok(created.record)
              })
            )
            .pipe(Effect.mapError(toStorageError("application.create")))

          return yield* unwrap(outcome)
        })

      const createManual: ApplicationServiceShape["createManual"] = (input) =>
        Effect.gen(function*() {
          const outcome = yield* asOutcome((tx) =>
              Effect.gen(function*() {
                if (!(yield* accountExists(tx, input.hhAccountId))) {
                  return fail({ _tag: "not_found", entity: "HhAccount", id: input.hhAccountId })
                }
                const vacancy = yield* vacancyFor(tx, input.vacancyId)
                if (vacancy === null) {
                  return fail({ _tag: "not_found", entity: "Vacancy", id: input.vacancyId })
                }

                if (vacancy.archived) {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: "the vacancy is archived; hh takes no responses"
                  })
                }

                const created = yield* ApplicationRepository.create(tx, {
                  userId: currentUser.userId,
                  hhAccountId: input.hhAccountId,
                  vacancyId: vacancy.id,
                  resumeId: input.resumeId ?? null,
                  streamId: null,
                  decisionId: null,
                  state: "draft"
                })

                if (created.created) {
                  yield* requestFormRead(tx, {
                    userId: currentUser.userId,
                    hhAccountId: input.hhAccountId,
                    vacancyId: vacancy.id,
                    priority: MANUAL_PREPARE_PRIORITY
                  })
                }
                return ok({ application: created.record, created: created.created })
              })
            )
            .pipe(Effect.mapError(toStorageError("application.createManual")))

          return yield* unwrap(outcome)
        })

      const approve: ApplicationServiceShape["approve"] = (id) =>
        Effect.gen(function*() {
          const outcome = yield* asOutcome((tx) =>
              Effect.gen(function*() {
                const application = yield* ApplicationRepository.findAny(tx, id)
                if (application === null || application.userId !== currentUser.userId) {
                  return fail({ _tag: "not_found", entity: "Application", id })
                }
                // Все проверки, лимит и постановка submit-задачи - в общем шлюзе.
                const outcome = yield* trySubmit(tx, {
                  userId: currentUser.userId,
                  application,
                  trigger: "approve",
                  fallbackLimit: options.dailyApplyLimit
                })
                return Match.value(outcome).pipe(
                  Match.tagsExhaustive({
                    queued: (queued) => ok(queued.application),
                    not_ready: (notReady) =>
                      fail({ _tag: "conflict", entity: "Application", message: notReady.message }),
                    parked: (parked) =>
                      fail({ _tag: "limit", limit: parked.limit, used: parked.used, resetsAt: parked.resetsAt }),
                    refused: (refused) =>
                      refused.reason === "kit_refused"
                        ? fail({ _tag: "answers", applicationId: id, problems: refused.problems })
                        : refused.reason === "no_vacancy"
                        ? fail({ _tag: "not_found", entity: "Vacancy", id: application.vacancyId })
                        : fail({ _tag: "conflict", entity: "Application", message: refused.message })
                  })
                )
              })
            )
            .pipe(Effect.mapError(toStorageError("application.approve")))

          return yield* unwrap(outcome)
        })

      const skip: ApplicationServiceShape["skip"] = (input) =>
        Effect.gen(function*() {
          const outcome = yield* asOutcome((tx) =>
              Effect.gen(function*() {
                const application = yield* ApplicationRepository.findAny(tx, input.id)
                if (application === null || application.userId !== currentUser.userId) {
                  return fail({ _tag: "not_found", entity: "Application", id: input.id })
                }
                if (application.state === "submitted") {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: "already submitted; skipping would misreport the site"
                  })
                }

                yield* QueueRepository.cancelForApplication(tx, input.id)
                const updated = yield* ApplicationRepository.transition(
                  tx,
                  currentUser.userId,
                  input.id,
                  "skipped",
                  {
                    from: ["draft", "preparing", "queued", "submitting", "needs_human", "failed"],
                    patch: { lastError: input.reason ?? null }
                  }
                )
                if (updated === null) {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: `cannot skip from state ${application.state}`
                  })
                }
                return ok(updated)
              })
            )
            .pipe(Effect.mapError(toStorageError("application.skip")))

          return yield* unwrap(outcome)
        })

      const retry: ApplicationServiceShape["retry"] = (id) =>
        Effect.gen(function*() {
          const outcome = yield* asOutcome((tx) =>
              Effect.gen(function*() {
                const application = yield* ApplicationRepository.findAny(tx, id)
                if (application === null || application.userId !== currentUser.userId) {
                  return fail({ _tag: "not_found", entity: "Application", id })
                }
                if (application.state === "submitted" || application.state === "submitting") {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: "submit already happened; retry would duplicate it"
                  })
                }

                const vacancy = yield* vacancyFor(tx, application.vacancyId)
                if (vacancy === null) {
                  return fail({
                    _tag: "not_found",
                    entity: "Vacancy",
                    id: application.vacancyId
                  })
                }

                yield* QueueRepository.cancelForApplication(tx, id)

                // A failed submit is never retried. The only safe recovery is
                // a reconcile: the site may have accepted the click.
                const submit = yield* QueueRepository.latestFor(tx, id, ["submit"])
                // The exception is a submit the harness proved was never clicked:
                // that one is prepared again from scratch.
                const unsent =
                  submit !== null &&
                  (submit.status === "failed" || submit.status === "needs_human") &&
                  (submit.result as { clicked?: unknown } | null)?.clicked === false
                const target = yield* targetFor(tx, application)
                if (target === null) {
                  return fail({ _tag: "not_found", entity: "Vacancy", id: application.vacancyId })
                }
                if (submit !== null && !unsent) {
                  const sequence =
                    yield* nextSequence(tx, id, "reconcile")
                  yield* reconcileJob(tx, { ...target, sequence })
                  const updated = yield* ApplicationRepository.transition(
                    tx,
                    currentUser.userId,
                    id,
                    "submitting",
                    { from: ["needs_human", "failed"], patch: { lastError: null } }
                  )
                  return updated === null
                    ? fail({
                        _tag: "conflict",
                        entity: "Application",
                        message: `cannot retry from state ${application.state}`
                      })
                    : ok(updated)
                }

                yield* requestFormRead(tx, {
                  userId: currentUser.userId,
                  hhAccountId: application.hhAccountId,
                  vacancyId: application.vacancyId,
                  force: true
                })

                // Повтор - не одобрение. После заведомо неотправленного submit форма
                // новая, и кит надо одобрить заново. Заявка без auto_run тоже
                // возвращается в draft: иначе следующее чтение формы отправило бы её
                // без одобрения. Только автоотклик, чей режим всё ещё auto, снова
                // отдаётся раннеру (`preparing`, слота ещё нет).
                // Заявка, созданная раннером в режиме `drafts`, при режиме строки
                // `auto` тоже уходит в авто: оператор включил автоотправку, и
                // повтор после капчи не должен снова ждать ручного одобрения.
                const governedByAuto =
                  !unsent &&
                  application.autoRun !== null &&
                  application.autoRun !== undefined &&
                  (yield* ApplyFilterRepository.governingAutoMode(
                    tx,
                    currentUser.userId,
                    application.hhAccountId,
                    application.resumeId ?? null
                  )) === "auto"
                const updated = yield* ApplicationRepository.transition(
                  tx,
                  currentUser.userId,
                  id,
                  governedByAuto ? "preparing" : "draft",
                  {
                    from: ["needs_human", "failed", "draft", "preparing"],
                    // Оператор сбрасывает и причину, и счётчик автоповторов.
                    patch: governedByAuto
                      ? { lastError: null, intentAt: null, autoRetries: 0, autoRun: "auto" }
                      : { lastError: null, autoRetries: 0 }
                  }
                )
                return updated === null
                  ? fail({
                      _tag: "conflict",
                      entity: "Application",
                      message: `cannot retry from state ${application.state}`
                    })
                  : ok(updated)
              })
            )
            .pipe(Effect.mapError(toStorageError("application.retry")))

          return yield* unwrap(outcome)
        })

      const setKit: ApplicationServiceShape["setKit"] = (input, setKitOptions) =>
        Effect.gen(function*() {
          const outcome = yield* asOutcome((tx) =>
              Effect.gen(function*() {
                const application = yield* ApplicationRepository.findAny(
                  tx,
                  input.applicationId
                )
                if (
                  application === null ||
                  application.userId !== currentUser.userId
                ) {
                  return fail({
                    _tag: "not_found",
                    entity: "Application",
                    id: input.applicationId
                  })
                }
                if (input.formHash.trim() === "") {
                  return fail({ _tag: "invalid", message: "formHash must not be empty" })
                }

                const kit = yield* ApplicationRepository.upsertKit(tx, {
                  userId: currentUser.userId,
                  applicationId: input.applicationId,
                  formHash: input.formHash,
                  letter: input.letter ?? null,
                  answers: input.answers ?? [],
                  model: input.model ?? null,
                  promptHash: input.promptHash ?? null,
                  costUsd: input.costUsd ?? null
                })

                // Кит сохранён - препятствие (письмо) снято, бюджет автоповторов
                // начинается заново.
                if (application.state === "preparing") {
                  yield* ApplicationRepository.resetAutoRetries(tx, currentUser.userId, application.id)
                }

                // Автоотклик ждёт в `preparing` именно этот кит. Когда он подходит к
                // сохранённой форме, шлюз сам проверит всё и поставит единственную
                // submit-задачу; иначе кит просто сохранён, решает человек.
                // Отправляет только вызов раннера: сохранение кита оператором
                // (RPC) никогда не ставит submit. Заявки без auto_run шлюз по
                // триггеру auto не отправляет.
                if (setKitOptions?.runner === true && application.state === "preparing") {
                  yield* trySubmit(tx, {
                    userId: currentUser.userId,
                    application,
                    trigger: "auto",
                    fallbackLimit: options.dailyApplyLimit
                  })
                }
                return ok(kit)
              })
            )
            .pipe(Effect.mapError(toStorageError("application.setKit")))

          return yield* unwrap(outcome)
        })

      const dailyUsage: ApplicationServiceShape["dailyUsage"] = (hhAccountId) =>
        Effect.gen(function*() {
          const outcome = yield* asOutcome((tx) =>
              Effect.gen(function*() {
                if (!(yield* accountExists(tx, hhAccountId))) {
                  return fail({ _tag: "not_found", entity: "HhAccount", id: hhAccountId })
                }
                const recent = yield* recentSubmits(tx, hhAccountId)
                const limit = yield* dailyLimitFor(tx, currentUser.userId, hhAccountId, options.dailyApplyLimit)
                return ok({
                  hhAccountId: hhAccountId as ApplyUsage["hhAccountId"],
                  used: recent.used,
                  limit,
                  remaining: Math.max(0, limit - recent.used),
                  oldest: recent.oldest === null ? null : recent.oldest.toISOString()
                } satisfies ApplyUsage)
              })
            )
            .pipe(Effect.mapError(toStorageError("application.dailyUsage")))

          return yield* unwrap(outcome)
        })

      const formGet: ApplicationServiceShape["formGet"] = (vacancyId) =>
        database
          .asUser(currentUser.userId, (tx) => VacancyFormRepository.getState(tx, vacancyId))
          .pipe(Effect.mapError(toStorageError("application.formGet")))

      const formRefresh: ApplicationServiceShape["formRefresh"] = (input) =>
        Effect.gen(function*() {
          const outcome = yield* asOutcome((tx) =>
              Effect.gen(function*() {
                if (!(yield* accountExists(tx, input.hhAccountId))) {
                  return fail({ _tag: "not_found", entity: "HhAccount", id: input.hhAccountId })
                }
                const state = yield* requestFormRead(tx, {
                  userId: currentUser.userId,
                  hhAccountId: input.hhAccountId,
                  vacancyId: input.vacancyId,
                  force: input.force,
                  priority: MANUAL_PREPARE_PRIORITY
                })
                return state === null
                  ? fail({ _tag: "not_found", entity: "Vacancy", id: input.vacancyId })
                  : ok(state)
              })
            )
            .pipe(Effect.mapError(toStorageError("application.formRefresh")))

          return yield* unwrap(outcome)
        })

      const retryCaptcha: ApplicationServiceShape["retryCaptcha"] = (input) =>
        Effect.gen(function*() {
          const ids = yield* database
            .asUser(currentUser.userId, (tx) =>
              ApplicationRepository.captchaStoppedIds(tx, currentUser.userId, input.hhAccountId)
            )
            .pipe(Effect.mapError(toStorageError("application.retryCaptcha")))
          let retried = 0
          const skipped: Array<{ applicationId: ApplicationId; reason: string }> = []
          for (const id of ids) {
            const result = yield* Effect.result(retry(id))
            if (result._tag === "Success") retried += 1
            else skipped.push({ applicationId: id as ApplicationId, reason: result.failure.message ?? result.failure._tag })
          }
          return { retried, skipped }
        })

      return ApplicationService.of({
        formGet,
        formRefresh,
        list,
        get,
        createFromDecision,
        createManual,
        approve,
        skip,
        retry,
        retryCaptcha,
        setKit,
        dailyUsage
      })
    })
  )
}
