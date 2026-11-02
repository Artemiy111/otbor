import type {
  Answer,
  ApiError,
  ApplicationDetail,
  ApplicationRecord,
  DecisionRecord,
  KitRecord
} from "@otbor/contract"
import { Conflict, InvalidInput, NotFound } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database, type Executor } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as DecisionRepository from "../repositories/DecisionRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { nextSequence, prepareJob, reconcileJob, submitJob } from "./jobs.ts"
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

export interface SetKitInput {
  readonly applicationId: string
  readonly formHash: string
  readonly letter?: string | null
  readonly answers?: ReadonlyArray<Answer>
  readonly model?: string | null
  readonly promptHash?: string | null
  readonly costUsd?: number | null
}

export interface ApplicationServiceShape {
  readonly list: (options: {
    readonly state?: string
    readonly limit?: number
  }) => Effect.Effect<ReadonlyArray<ApplicationRecord>, ApiError>
  readonly get: (id: string) => Effect.Effect<ApplicationDetail, ApiError>
  readonly createFromDecision: (
    input: CreateFromDecisionInput
  ) => Effect.Effect<ApplicationRecord, ApiError>
  readonly approve: (id: string) => Effect.Effect<ApplicationRecord, ApiError>
  readonly skip: (input: { readonly id: string; readonly reason?: string }) => Effect.Effect<
    ApplicationRecord,
    ApiError
  >
  readonly retry: (id: string) => Effect.Effect<ApplicationRecord, ApiError>
  readonly setKit: (input: SetKitInput) => Effect.Effect<KitRecord, ApiError>
}

export class ApplicationService extends Context.Service<ApplicationService, ApplicationServiceShape>()(
  "otbor/cloud/ApplicationService"
) {
  static readonly layer = Layer.effect(
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
                return { ...base, decision } satisfies ApplicationDetail
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
                  resumeId: input.resumeId ?? null,
                  streamId: null,
                  decisionId: decision.id,
                  state
                })

                if (created.created) {
                  const sequence =
                    yield* nextSequence(tx, created.record.id, "prepare")
                  yield* prepareJob(tx, {
                    userId: currentUser.userId,
                    hhAccountId: input.hhAccountId,
                    applicationId: created.record.id,
                    vacancyId: vacancy.id,
                    canonicalUrl: vacancy.canonicalUrl,
                    resumeId: input.resumeId ?? null,
                    priority: Math.round(decision.priority),
                    sequence
                  })
                }

                return ok(created.record)
              })
            )
            .pipe(Effect.mapError(toStorageError("application.create")))

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

                const kit = yield* ApplicationRepository.findKit(tx, id)
                if (kit === null) {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: "the form is not prepared yet; run prepare first"
                  })
                }

                // At-most-once: once a submit job exists, approving again may
                // only observe it. A terminal failure means a human must
                // reconcile, never that the click is repeated.
                const existing = yield* QueueRepository.latestFor(tx, id, ["submit"])
                if (
                  existing !== null &&
                  (existing.status === "failed" ||
                    existing.status === "dead" ||
                    existing.status === "needs_human" ||
                    existing.status === "needs_reconcile" ||
                    existing.status === "done")
                ) {
                  return fail({
                    _tag: "conflict",
                    entity: "Application",
                    message: `submit was already attempted (${existing.status}); reconcile, do not resubmit`
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

                if (existing === null) {
                  const vacancy = yield* vacancyFor(tx, updated.vacancyId)
                  if (vacancy === null) {
                    return fail({
                      _tag: "not_found",
                      entity: "Vacancy",
                      id: updated.vacancyId
                    })
                  }
                  yield* submitJob(tx, {
                    userId: currentUser.userId,
                    hhAccountId: updated.hhAccountId,
                    applicationId: updated.id,
                    vacancyId: updated.vacancyId,
                    canonicalUrl: vacancy.canonicalUrl,
                    resumeId: updated.resumeId ?? null,
                    kitId: kit.id
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
                if (submit !== null) {
                  const sequence =
                    yield* nextSequence(tx, id, "reconcile")
                  yield* reconcileJob(tx, {
                    userId: currentUser.userId,
                    hhAccountId: application.hhAccountId,
                    applicationId: application.id,
                    vacancyId: vacancy.id,
                    canonicalUrl: vacancy.canonicalUrl,
                    sequence
                  })
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

                const sequence = yield* nextSequence(tx, id, "prepare")
                yield* prepareJob(tx, {
                  userId: currentUser.userId,
                  hhAccountId: application.hhAccountId,
                  applicationId: application.id,
                  vacancyId: vacancy.id,
                  canonicalUrl: vacancy.canonicalUrl,
                  resumeId: application.resumeId ?? null,
                  priority: 0,
                  sequence
                })

                const updated = yield* ApplicationRepository.transition(tx, currentUser.userId, id, "queued", {
                  from: ["needs_human", "failed", "draft"],
                  patch: { lastError: null }
                })
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
                return ok(kit)
              })
            )
            .pipe(Effect.mapError(toStorageError("application.setKit")))

          return yield* unwrap(outcome)
        })

      return ApplicationService.of({
        list,
        get,
        createFromDecision,
        approve,
        skip,
        retry,
        setKit
      })
    })
  )
}
