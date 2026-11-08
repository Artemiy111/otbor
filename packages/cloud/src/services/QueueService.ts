import type {
  ApiError,
  HarnessExit,
  HarnessId,
  HarnessJob,
  HarnessRegistration,
  HeartbeatResult,
  JobKind,
  QueueStats
} from "@otbor/contract"
import { HarnessRejected, NotFound } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Cause, Config, Context, Effect, Layer } from "effect"
import { generateHarnessToken, hashHarnessToken } from "../auth/harnessToken.ts"
import { Database } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as HhAccountRepository from "../repositories/HhAccountRepository.ts"
import * as HarnessRepository from "../repositories/HarnessRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import { AutoApplyRunner } from "./AutoApplyRunner.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { attemptArtifacts } from "./applyRules.ts"
import { completeFitInference } from "./fitJudge.ts"
import { stageHandlers, type AppState } from "./completion/index.ts"
import { nextSequence, reconcileJob, targetFor } from "./jobs.ts"
import { toStorageError } from "./support.ts"
import { DEFAULT_DAILY_APPLY_LIMIT } from "./dailyLimit.ts"

export { exitDetail } from "./completion/index.ts"

/* -------------------------------------------------------------------------- */
/* Outcomes                                                                   */
/* -------------------------------------------------------------------------- */

type Failure =
  | { readonly _tag: "not_found"; readonly entity: string; readonly id: string }
  | { readonly _tag: "rejected"; readonly message: string }

type Outcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly failure: Failure }

const ok = <A>(value: A): Outcome<A> => ({ ok: true, value })
const fail = (failure: Failure): Outcome<never> => ({ ok: false, failure })

const raise = (failure: Failure): ApiError =>
  failure._tag === "not_found"
    ? new NotFound({ entity: failure.entity, id: failure.id })
    : new HarnessRejected({ message: failure.message })

const unwrap = <A>(outcome: Outcome<A>): Effect.Effect<A, ApiError> =>
  outcome.ok ? Effect.succeed(outcome.value) : Effect.fail(raise(outcome.failure))

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** One message for unknown, unregistered and revoked harnesses alike. */
const invalidToken = "invalid harness token; register again to receive a new one"

/** Из каких состояний завершение задачи вправе перевести заявку в `to`. */
const transitionFrom = (
  to: AppState,
  stage: HarnessJob["stage"]
): ReadonlyArray<AppState> =>
  to === "submitted"
    ? ["submitting", "needs_human", "failed"]
    : to === "submitting"
      ? ["queued", "submitting"]
      : to === "needs_human"
        ? ["draft", "queued", "submitting", "needs_human", "failed"]
        : to === "failed"
          ? ["draft", "queued", "submitting", "needs_human", "failed"]
          : to === "draft" && stage === "reconcile"
            ? ["submitting", "needs_human", "failed"]
            : ["draft", "queued"]

const asAttemptStage = (
  stage: HarnessJob["stage"]
): "prepare" | "submit" | "reconcile" | null =>
  stage === "prepare" || stage === "submit" || stage === "reconcile" ? stage : null

export interface RegisterInput {
  readonly name: string
  readonly kinds: ReadonlyArray<JobKind>
  readonly accounts: ReadonlyArray<string>
}

export interface LeaseInput {
  readonly harnessId: string
  /** Device token from `register`; every harness request proves it. */
  readonly token: string
  readonly kinds: ReadonlyArray<JobKind>
  readonly accounts: ReadonlyArray<string>
  readonly waitSeconds?: number
}

export interface HeartbeatInput {
  readonly harnessId: string
  readonly token: string
  readonly jobId: string
  readonly leaseId: string
  readonly epoch: number
}

export interface CompleteInput extends HeartbeatInput {
  readonly exit: HarnessExit
}

export interface RevokeResult {
  readonly harnessId: HarnessId
  readonly revoked: boolean
}

export interface CompleteResult {
  readonly status: string
  readonly accepted: boolean
  readonly message?: string | null
}

/** Итог завершения вместе с заявками, которые раннер двигает после коммита. */
interface Completed extends CompleteResult {
  readonly advance: ReadonlyArray<string>
}

export interface QueueServiceShape {
  readonly stats: (kind?: string) => Effect.Effect<QueueStats, ApiError>
  readonly jobs: (options: {
    readonly status?: string
    readonly kind?: string
    readonly limit?: number
  }) => Effect.Effect<ReadonlyArray<HarnessJob>, ApiError>
  readonly register: (input: RegisterInput) => Effect.Effect<HarnessRegistration, ApiError>
  readonly leaseNext: (input: LeaseInput) => Effect.Effect<{ readonly job: HarnessJob | null }, ApiError>
  readonly heartbeat: (input: HeartbeatInput) => Effect.Effect<HeartbeatResult, ApiError>
  readonly complete: (input: CompleteInput) => Effect.Effect<CompleteResult, ApiError>
  readonly revoke: (input: { readonly harnessId: string }) => Effect.Effect<RevokeResult, ApiError>
}

export interface QueueServiceOptions {
  /** Daily sends per hh account when the account has no apply filter row. */
  readonly dailyApplyLimit: number
  /**
   * Двигать автозаявки раннером сразу после завершения задачи (по умолчанию да).
   * Тесты, которые сами вызывают проходы раннера, выключают: фоновый шаг
   * делал бы их порядок недетерминированным.
   */
  readonly advanceOnComplete?: boolean
}

export class QueueService extends Context.Service<QueueService, QueueServiceShape>()(
  "otbor/cloud/QueueService"
) {
  /** Как `layer`, с переопределением остальных настроек. */
  static readonly layerConfigured = (overrides: Omit<QueueServiceOptions, "dailyApplyLimit">) =>
    Layer.unwrap(
      Config.Int("OTBOR_DAILY_APPLY_LIMIT").pipe(
        Config.withDefault(DEFAULT_DAILY_APPLY_LIMIT),
        Effect.map((dailyApplyLimit) => QueueService.layerWith({ dailyApplyLimit, ...overrides }))
      )
    )

  /** Production layer: the fallback daily limit is `OTBOR_DAILY_APPLY_LIMIT` (default 200). */
  static readonly layer = QueueService.layerConfigured({})

  static readonly layerWith = (options: QueueServiceOptions) =>
  Layer.effect(
    QueueService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser
      const autoApply = yield* AutoApplyRunner

      /**
       * После коммита завершения: раннер двигает автозаявки, которых ждала эта
       * задача (форма прочитана, письмо готово). Отдельный fiber: ответ
       * харнессу не ждёт раннера, сбой только в лог, расписание остаётся
       * запасным путём.
       */
      const advanceLater = (userId: string, applicationIds: ReadonlyArray<string>) =>
        autoApply.advance(userId, applicationIds).pipe(
          Effect.asVoid,
          Effect.catchCause((cause) =>
            Effect.logWarning(`autoapply advance after job completion failed: ${Cause.pretty(cause)}`)
          ),
          Effect.forkDetach,
          Effect.asVoid
        )

      const stats: QueueServiceShape["stats"] = (kind) =>
        database
          .asUser(currentUser.userId, (tx) => QueueRepository.stats(tx, kind))
          .pipe(Effect.mapError(toStorageError("queue.stats")))

      const jobs: QueueServiceShape["jobs"] = (options) =>
        database
          .asUser(currentUser.userId, (tx) => QueueRepository.list(tx, options))
          .pipe(Effect.mapError(toStorageError("queue.list")))

      const register: QueueServiceShape["register"] = (input) =>
        Effect.gen(function*() {
          // Generated per registration, including a re-registration: the token
          // is shown once and only its hash is stored.
          const token = generateHarnessToken()
          const tokenHash = hashHarnessToken(token)

          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                if (input.name.trim() === "") {
                  return fail({ _tag: "rejected", message: "harness name must not be empty" })
                }

                if (input.accounts.length > 0) {
                  const rows = yield* tx.execute(sql`
                    select id from hh_account
                    where id in (${sql.join(
                      input.accounts.map((account) => sql`${account}`),
                      sql`, `
                    )})
                  `)
                  if (rows.rows.length !== input.accounts.length) {
                    return fail({
                      _tag: "rejected",
                      message: "every harness account must belong to the current user"
                    })
                  }
                }

                const registration = yield* HarnessRepository.register(tx, {
                  userId: currentUser.userId,
                  name: input.name,
                  kinds: input.kinds,
                  accounts: input.accounts,
                  tokenHash
                })
                return ok({ ...registration, token })
              })
            )
            .pipe(Effect.mapError(toStorageError("harness.register")))

          const registration = yield* unwrap(outcome)

          // A rebind must drop the old runtime lease too. account_lease is
          // owner-only under RLS, so cleanup happens after the user-scoped
          // registration transaction commits.
          if (input.accounts.length > 0) {
            const accounts = sql.join(
              input.accounts.map((account) => sql`${account}`),
              sql`, `
            )
            yield* database
              .asOwner((tx) =>
                tx.execute(sql`
                  delete from account_lease
                  where hh_account_id in (${accounts}) and holder <> ${registration.id}
                `)
              )
              .pipe(Effect.mapError(toStorageError("harness.register")))
          }

          return registration
        })

      const claimOnce = (input: LeaseInput) =>
        database
          .asOwner((tx) =>
            Effect.gen(function*() {
              const claimed = yield* QueueRepository.claim(tx, {
                holder: input.harnessId,
                kinds: input.kinds,
                accounts: input.accounts
              })
              if (claimed === null) return null

              const { job } = claimed

              // A submit job is leased only if it can immediately become the
              // single in-flight attempt; the queue filter already enforces
              // this, but the application write is the authority.
              if (job.stage === "submit" && claimed.applicationId !== null) {
                const moved = yield* ApplicationRepository.transition(
                  tx,
                  claimed.userId,
                  claimed.applicationId,
                  "submitting",
                  { from: ["queued"], patch: { lastError: null } }
                )
                if (moved === null) {
                  yield* QueueRepository.complete(tx, {
                    jobId: job.id,
                    leaseId: job.leaseId!,
                    epoch: job.leaseEpoch,
                    holder: input.harnessId,
                    status: "cancelled",
                    lastError: "application left the queued state before submit"
                  })
                  return null
                }
              }

              const stage = asAttemptStage(job.stage)
              if (stage !== null && claimed.applicationId !== null) {
                yield* ApplicationRepository.appendAttempt(tx, {
                  userId: claimed.userId,
                  applicationId: claimed.applicationId,
                  stage,
                  harnessId: input.harnessId
                })
              }

              return job
            })
          )
          .pipe(Effect.mapError(toStorageError("harness.lease")))

      const leaseNext: QueueServiceShape["leaseNext"] = (input) =>
        Effect.gen(function*() {
          const authenticated = yield* database
            .asUser(currentUser.userId, (tx) =>
              HarnessRepository.authenticate(tx, input.harnessId, hashHarnessToken(input.token))
            )
            .pipe(Effect.mapError(toStorageError("harness.lease")))
          if (!authenticated) {
            return yield* new HarnessRejected({ message: invalidToken })
          }

          // Every poll is proof of life; the health page and the job queue read it.
          yield* database
            .asUser(currentUser.userId, (tx) => HarnessRepository.touch(tx, input.harnessId))
            .pipe(Effect.mapError(toStorageError("harness.lease")))

          const registered = yield* database
            .asUser(currentUser.userId, (tx) =>
              HarnessRepository.accountsFor(tx, input.harnessId)
            )
            .pipe(Effect.mapError(toStorageError("harness.lease")))

          // A harness may only pull work for accounts bound to it.
          const accounts = input.accounts.length === 0 ? registered : input.accounts.filter(
            (account) => registered.includes(account)
          )

          const deadline = Date.now() + Math.min(Math.max(input.waitSeconds ?? 0, 0), 30) * 1_000

          while (true) {
            const job = yield* claimOnce({ ...input, accounts })
            if (job !== null) return { job }
            if (Date.now() >= deadline) return { job: null }
            yield* Effect.sleep("750 millis")
          }
        })

      const heartbeat: QueueServiceShape["heartbeat"] = (input) =>
        Effect.gen(function*() {
          const result = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                if (
                  !(yield* HarnessRepository.authenticate(
                    tx,
                    input.harnessId,
                    hashHarnessToken(input.token)
                  ))
                ) {
                  return null
                }
                yield* HarnessRepository.touch(tx, input.harnessId)
                return yield* QueueRepository.heartbeat(tx, {
                  jobId: input.jobId,
                  leaseId: input.leaseId,
                  epoch: input.epoch,
                  holder: input.harnessId
                })
              })
            )
            .pipe(Effect.mapError(toStorageError("harness.heartbeat")))

          if (result === null) {
            return yield* new HarnessRejected({ message: invalidToken })
          }

          return result
            ? { ok: true, reason: null }
            : { ok: false, reason: "lease expired or was superseded; stop working" }
        })

      const complete: QueueServiceShape["complete"] = (input) =>
        Effect.gen(function*() {
          const outcome = yield* database
            .asUser(currentUser.userId, (tx) =>
              Effect.gen(function*() {
                if (
                  !(yield* HarnessRepository.authenticate(
                    tx,
                    input.harnessId,
                    hashHarnessToken(input.token)
                  ))
                ) {
                  return fail({ _tag: "rejected", message: invalidToken })
                }

                const ctx = yield* QueueRepository.context(tx, input.jobId)
                if (ctx === null || ctx.userId !== currentUser.userId) {
                  return fail({ _tag: "not_found", entity: "HarnessJob", id: input.jobId })
                }

                const { job } = ctx
                if (
                  job.leaseId !== input.leaseId ||
                  job.leaseEpoch !== input.epoch ||
                  ctx.lockedBy !== input.harnessId
                ) {
                  return fail({
                    _tag: "rejected",
                    message: "stale lease: another performer owns this job"
                  })
                }

                const exit = input.exit
                // Решение по стадии: что стало с задачей и заявкой.
                const decided = yield* stageHandlers[job.stage](tx, ctx, exit, options)
                const { status, message, runAt, appState, appPatch, enqueue, jobResult, reconcileKept, settle } =
                  decided

                const accepted = yield* QueueRepository.complete(tx, {
                  jobId: job.id,
                  leaseId: input.leaseId,
                  epoch: input.epoch,
                  holder: input.harnessId,
                  status,
                  lastError: message,
                  result: jobResult,
                  runAt
                })

                if (!accepted) {
                  return ok<Completed>({
                    status: job.status,
                    accepted: false,
                    message: "stale lease",
                    advance: []
                  })
                }

                // A login page where a session was expected proves the cookies
                // are dead: record it so status and health show the account.
                if (exit.tag === "session_expired" && ctx.applicationId !== null) {
                  const owner = yield* ApplicationRepository.findAny(tx, ctx.applicationId)
                  if (owner !== null) {
                    yield* HhAccountRepository.setSession(tx, {
                      userId: ctx.userId,
                      id: owner.hhAccountId,
                      state: "expired",
                      error: exit.message ?? "hh redirected to the login page"
                    })
                  }
                }

                // A fit judgement may be waiting for this inference job: store
                // it and re-decide the vacancy in the same transaction.
                if (job.stage === "inference") {
                  yield* completeFitInference(tx, ctx.userId, {
                    id: job.id,
                    status,
                    result: jobResult,
                    message
                  })
                }

                const stage = asAttemptStage(job.stage)
                if (stage !== null && ctx.applicationId !== null) {
                  const attemptId = yield* ApplicationRepository.openAttempt(
                    tx,
                    ctx.applicationId,
                    stage
                  )
                  if (attemptId !== null) {
                    // The journal keeps evidence, not page bodies: a page can
                    // be hundreds of kilobytes and holds the user's answers.
                    const kept = job.stage === "reconcile"
                      ? reconcileKept ?? { verdict: "none" }
                      : attemptArtifacts(exit)
                    yield* ApplicationRepository.finishAttempt(
                      tx,
                      attemptId,
                      kept === null ? exit : { ...exit, artifacts: kept },
                      kept
                    )
                  }
                }

                if (appState !== null && ctx.applicationId !== null) {
                  const moved = yield* ApplicationRepository.transition(
                    tx,
                    ctx.userId,
                    ctx.applicationId,
                    appState,
                    {
                      from: transitionFrom(appState, job.stage),
                      patch: appPatch
                    }
                  )

                  // The reconcile explained the parked submit: close it so the
                  // queue and the application agree, and stop further reads.
                  // Only when the application really moved (a person may have
                  // skipped it meanwhile).
                  if (settle !== null && moved !== null) {
                    yield* QueueRepository.settleSubmit(tx, ctx.applicationId, settle)
                    yield* QueueRepository.cancelForApplication(tx, ctx.applicationId, [
                      "prepare",
                      "submit",
                      "session",
                      "inference"
                    ])
                  }
                }

                if (enqueue === "reconcile" && ctx.applicationId !== null) {
                  const application = yield* ApplicationRepository.findAny(tx, ctx.applicationId)
                  const target = application ? yield* targetFor(tx, application) : null
                  if (target !== null) {
                    yield* reconcileJob(tx, {
                      ...target,
                      sequence: yield* nextSequence(tx, target.applicationId, "reconcile")
                    })
                  }
                }

                return ok<Completed>({ status, accepted: true, message, advance: decided.advance })
              })
            )
            .pipe(Effect.mapError(toStorageError("harness.complete")))

          const { advance, ...result } = yield* unwrap(outcome)
          // Транзакция уже закоммичена: раннер увидит завершённую задачу.
          if (advance.length > 0 && options.advanceOnComplete !== false) yield* advanceLater(currentUser.userId, advance)
          return result
        })

      const revoke: QueueServiceShape["revoke"] = (input) =>
        Effect.gen(function*() {
          const revoked = yield* database
            .asUser(currentUser.userId, (tx) =>
              HarnessRepository.revoke(tx, input.harnessId)
            )
            .pipe(Effect.mapError(toStorageError("harness.revoke")))

          if (revoked) {
            yield* database
              .asOwner((tx) =>
                tx.execute(sql`delete from account_lease where holder = ${input.harnessId}`)
              )
              .pipe(Effect.mapError(toStorageError("harness.revoke")))
          }

          return { harnessId: input.harnessId as HarnessId, revoked }
        })

      return QueueService.of({
        stats,
        jobs,
        register,
        leaseNext,
        heartbeat,
        complete,
        revoke
      })
    })
  ).pipe(Layer.provide(AutoApplyRunner.layerWith({ dailyApplyLimit: options.dailyApplyLimit })))
}
