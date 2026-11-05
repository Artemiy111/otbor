import type {
  ApiError,
  ApplicationDetail,
  ApplicationRecord,
  KitAnswer,
  KitRecord,
  VacancyFormState
} from "@otbor/contract"
import { AnswersInvalid, Conflict, InvalidInput, LimitExceeded, NotFound } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Config, Context, Effect, Layer } from "effect"
import { Database, type Executor } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { checkKit, type KitProblem } from "./applyRules.ts"
import { nextSequence, reconcileJob, submitJob, targetFor } from "./jobs.ts"
import * as VacancyFormRepository from "../repositories/VacancyFormRepository.ts"
import { FORM_TTL_MS } from "../repositories/VacancyFormRepository.ts"
import { currentFormFor, requestFormRead } from "./vacancyForm.ts"
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

const raise = (failure: Failure): ApiError => {
  switch (failure._tag) {
    case "not_found":
      return new NotFound({ entity: failure.entity, id: failure.id })
    case "conflict":
      return new Conflict({ entity: failure.entity, message: failure.message })
    case "invalid":
      return new InvalidInput({ message: failure.message })
    case "answers":
      return new AnswersInvalid({
        applicationId: failure.applicationId,
        message: `the kit cannot be approved: ${failure.problems.map((problem) => problem.code).join(", ")}`,
        problems: failure.problems
      })
    case "limit":
      return new LimitExceeded({ limit: failure.limit, used: failure.used, resetsAt: failure.resetsAt })
  }
}

const unwrap = <A>(outcome: Outcome<A>): Effect.Effect<A, ApiError> =>
  outcome.ok ? Effect.succeed(outcome.value) : Effect.fail(raise(outcome.failure))

/* -------------------------------------------------------------------------- */
/* Queue helpers                                                              */
/* -------------------------------------------------------------------------- */

const accountExists = (tx: Executor, id: string) =>
  tx
    .execute(sql`select id from hh_account where id = ${id} limit 1`)
    .pipe(Effect.map((result) => result.rows.length > 0))

/** Daily submits per hh account when `OTBOR_DAILY_APPLY_LIMIT` is not set. */
export const DEFAULT_DAILY_APPLY_LIMIT = 30

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Applications of one account that were approved in the last 24 hours and
 * still stand (queued, submitting or submitted). `intent_at` is written by
 * approve; auto-mode rows without it fall back to `submitted_at`.
 * `oldest` is the timestamp that frees the first slot.
 */
const recentSubmits = (tx: Executor, hhAccountId: string, excludeId: string) =>
  tx
    .execute(sql`
      select count(*)::int as used, min(coalesce(intent_at, submitted_at)) as oldest
      from application
      where hh_account_id = ${hhAccountId}
        and id <> ${excludeId}
        and origin = 'otbor'
        and state in ('queued', 'submitting', 'submitted')
        and coalesce(intent_at, submitted_at) > now() - interval '24 hours'
    `)
    .pipe(
      Effect.map((result) => {
        const row = result.rows[0] as unknown as { used: number; oldest: Date | string | null } | undefined
        const oldest = row?.oldest == null ? null : new Date(row.oldest)
        return { used: row?.used ?? 0, oldest }
      })
    )

const vacancyFor = (tx: Executor, id: string) => VacancyRepository.findById(tx, id)

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreateFromDecisionInput {
  readonly decisionId: string
  readonly hhAccountId: string
  readonly resumeId?: string
  readonly mode?: "drafts" | "auto"
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
  readonly setKit: (input: SetKitInput) => Effect.Effect<KitRecord, ApiError>
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
  /** Approvals allowed per hh account in any 24 hours. */
  readonly dailyApplyLimit: number
}

export class ApplicationService extends Context.Service<ApplicationService, ApplicationServiceShape>()(
  "otbor/cloud/ApplicationService"
) {
  /** Production layer: the daily limit comes from `OTBOR_DAILY_APPLY_LIMIT` (default 30). */
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
                return { ...base, form, decision } satisfies ApplicationDetail
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
          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
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

                const state = input.mode === "auto" ? "queued" : "draft"
                const created = yield* ApplicationRepository.create(tx, {
                  userId: currentUser.userId,
                  hhAccountId: input.hhAccountId,
                  vacancyId: vacancy.id,
                  resumeId: input.resumeId ?? decision.resumeId ?? null,
                  streamId: null,
                  decisionId: decision.id,
                  state
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
          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                if (!(yield* accountExists(tx, input.hhAccountId))) {
                  return fail({ _tag: "not_found", entity: "HhAccount", id: input.hhAccountId })
                }
                const vacancy = yield* vacancyFor(tx, input.vacancyId)
                if (vacancy === null) {
                  return fail({ _tag: "not_found", entity: "Vacancy", id: input.vacancyId })
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
          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                const application = yield* ApplicationRepository.findAny(tx, id)
                if (application === null || application.userId !== currentUser.userId) {
                  return fail({ _tag: "not_found", entity: "Application", id })
                }
                if (application.state === "submitted") {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: "already submitted"
                  })
                }
                if (application.state === "submitting") {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: "submit is in flight; reconcile instead of approving again"
                  })
                }

                const stored = yield* currentFormFor(tx, application)
                if (stored === null) {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: "the form has not been read yet; refresh the vacancy form first"
                  })
                }
                // The kit was written against a form that may have changed since.
                // A day-old read is not trusted for an irreversible send; the
                // submit itself still compares the live form hash.
                if (Date.now() - Date.parse(stored.fetchedAt) > FORM_TTL_MS) {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: "the stored form is older than a day; refresh the vacancy form first"
                  })
                }
                const kit = yield* ApplicationRepository.findKit(tx, id, stored.form.formHash)
                if (kit === null) {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: "there is no kit for the current form; set a kit first"
                  })
                }

                // Hard hints, required questions, code tasks and flagged
                // answers are checked here, before anything can be queued.
                const problems = checkKit({ form: stored.form, hints: stored.hints, kit })
                if (problems.length > 0) {
                  return fail({ _tag: "answers", applicationId: id, problems })
                }

                // At-most-once: once a submit job exists, approving again may
                // only observe it. A terminal failure means a human must
                // reconcile, never that the click is repeated. The one
                // exception is a submit the harness proved was never clicked
                // (`form_changed`, captcha, expired session ...): that job
                // recorded `clicked: false` and a new submit gets its own key.
                const existing = yield* QueueRepository.latestFor(tx, id, ["submit"])
                const unsent =
                  existing !== null &&
                  (existing.status === "failed" || existing.status === "needs_human") &&
                  (existing.result as { clicked?: unknown } | null)?.clicked === false
                if (existing !== null && !unsent) {
                  if (
                    existing.status === "failed" ||
                    existing.status === "dead" ||
                    existing.status === "needs_human" ||
                    existing.status === "needs_reconcile" ||
                    existing.status === "done"
                  ) {
                    return fail({
                      _tag: "conflict",
                      entity: "Application",
                      message: `submit was already attempted (${existing.status}); reconcile, do not resubmit`
                    })
                  }
                }

                // The real safety net behind any chat or CLI front end: a hard
                // per-account cap on approvals in a rolling 24 hours.
                if (!(["draft", "needs_human", "failed"] as ReadonlyArray<string>).includes(application.state)) {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: `cannot approve from state ${application.state}`
                  })
                }
                const recent = yield* recentSubmits(tx, application.hhAccountId, id)
                if (recent.used >= options.dailyApplyLimit) {
                  return fail({
                    _tag: "limit",
                    limit: options.dailyApplyLimit,
                    used: recent.used,
                    resetsAt: new Date((recent.oldest?.getTime() ?? Date.now()) + DAY_MS).toISOString()
                  })
                }

                const updated = yield* ApplicationRepository.transition(tx, currentUser.userId, id, "queued", {
                  from: ["draft", "needs_human", "failed"],
                  patch: { intentAt: new Date(), lastError: null }
                })
                if (updated === null) {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: `cannot approve from state ${application.state}`
                  })
                }

                if (existing === null || unsent) {
                  const target = yield* targetFor(tx, updated)
                  if (target === null) {
                    return fail({
                      _tag: "not_found",
                      entity: "Vacancy",
                      id: updated.vacancyId
                    })
                  }
                  yield* submitJob(tx, {
                    ...target,
                    kit,
                    form: stored.form,
                    sequence: (yield* nextSequence(tx, id, "submit"))
                  })
                }

                return ok(updated)
              })
            )
            .pipe(Effect.mapError(toStorageError("application.approve")))

          return yield* unwrap(outcome)
        })

      const skip: ApplicationServiceShape["skip"] = (input) =>
        Effect.gen(function*() {
          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
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
                    from: ["draft", "queued", "submitting", "needs_human", "failed"],
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
          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
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

                // After a provably unsent submit the form is new: the kit has to
                // be approved again, so the application goes back to draft
                // instead of auto-submitting the next kit.
                const updated = yield* ApplicationRepository.transition(
                  tx,
                  currentUser.userId,
                  id,
                  unsent ? "draft" : "queued",
                  {
                    from: ["needs_human", "failed", "draft"],
                    patch: { lastError: null }
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

      const setKit: ApplicationServiceShape["setKit"] = (input) =>
        Effect.gen(function*() {
          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
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

                // An auto-mode application waits in `queued` for exactly this
                // kit. When it matches the prepared form and passes every
                // check, the single submit job is queued; otherwise the kit is
                // only stored and a human decides.
                if (application.state === "queued") {
                  const stored = yield* currentFormFor(tx, application)
                  const existing = yield* QueueRepository.latestFor(tx, application.id, ["submit"])
                  if (
                    stored !== null &&
                    existing === null &&
                    stored.form.formHash === kit.formHash &&
                    checkKit({ form: stored.form, hints: stored.hints, kit }).length === 0
                  ) {
                    const target = yield* targetFor(tx, application)
                    if (target !== null) {
                      yield* submitJob(tx, {
                        ...target,
                        kit,
                        form: stored.form,
                        sequence: yield* nextSequence(tx, application.id, "submit")
                      })
                    }
                  }
                }
                return ok(kit)
              })
            )
            .pipe(Effect.mapError(toStorageError("application.setKit")))

          return yield* unwrap(outcome)
        })

      const formGet: ApplicationServiceShape["formGet"] = (vacancyId) =>
        database
          .asUser(currentUser.userId, (tx) => VacancyFormRepository.getState(tx, vacancyId))
          .pipe(Effect.mapError(toStorageError("application.formGet")))

      const formRefresh: ApplicationServiceShape["formRefresh"] = (input) =>
        Effect.gen(function*() {
          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
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
        setKit
      })
    })
  )
}
