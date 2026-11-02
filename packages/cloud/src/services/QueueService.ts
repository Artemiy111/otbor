import type {
  ApiError,
  HarnessExit,
  HarnessId,
  HarnessJob,
  HarnessRegistration,
  HeartbeatResult,
  JobKind,
  JobStatus,
  QueueStats
} from "@otbor/contract"
import { HarnessRejected, NotFound } from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { generateHarnessToken, hashHarnessToken } from "../auth/harnessToken.ts"
import { Database } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as HarnessRepository from "../repositories/HarnessRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import { nextSequence, reconcileJob, submitJob } from "./jobs.ts"
import { toStorageError } from "./support.ts"

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

/** Retry the same row; the lease and epoch make a duplicate harmless. */
const retryLater = (exit: HarnessExit, fallbackSeconds: number) =>
  new Date(Date.now() + Math.max(exit.retryAfterSeconds ?? fallbackSeconds, 1) * 1_000)

const terminalFailure: ReadonlyArray<string> = [
  "permanent",
  "site_rejected",
  "resume_mismatch",
  "answer_rejected",
  "form_changed"
]

const needsHuman: ReadonlyArray<string> = ["captcha", "session_expired"]

const retryable: ReadonlyArray<string> = [
  "transport",
  "rate_limited",
  "inference_failed",
  "ambiguous"
]

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

export interface QueueServiceShape {
  readonly stats: () => Effect.Effect<QueueStats, ApiError>
  readonly jobs: (options: {
    readonly status?: string
    readonly limit?: number
  }) => Effect.Effect<ReadonlyArray<HarnessJob>, ApiError>
  readonly register: (input: RegisterInput) => Effect.Effect<HarnessRegistration, ApiError>
  readonly leaseNext: (input: LeaseInput) => Effect.Effect<{ readonly job: HarnessJob | null }, ApiError>
  readonly heartbeat: (input: HeartbeatInput) => Effect.Effect<HeartbeatResult, ApiError>
  readonly complete: (input: CompleteInput) => Effect.Effect<CompleteResult, ApiError>
  readonly revoke: (input: { readonly harnessId: string }) => Effect.Effect<RevokeResult, ApiError>
}

export class QueueService extends Context.Service<QueueService, QueueServiceShape>()(
  "otbor/cloud/QueueService"
) {
  static readonly layer = Layer.effect(
    QueueService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

      const stats: QueueServiceShape["stats"] = () =>
        database
          .asUser(currentUser.userId, (tx) => QueueRepository.stats(tx))
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

          return yield* unwrap(outcome)
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
                let status: JobStatus = "done"
                let message: string | null = null
                let runAt: Date | null | undefined
                let appState: "draft" | "queued" | "submitting" | "submitted" | "needs_human" | "failed" | null =
                  null
                let appPatch: Record<string, unknown> = {}
                let enqueue: "reconcile" | "submit" | null = null

                switch (job.stage) {
                  case "prepare": {
                    if (exit.tag === "prepared") {
                      const kit =
                        ctx.applicationId === null
                          ? null
                          : yield* ApplicationRepository.findKit(tx, ctx.applicationId)
                      if (kit === null) {
                        status = "needs_human"
                        appState = "needs_human"
                        message = "harness reported prepared but the kit is missing"
                      } else if (ctx.applicationId !== null && ctx.hhAccountId !== null) {
                        const application = yield* ApplicationRepository.findAny(
                          tx,
                          ctx.applicationId
                        )
                        const vacancy = application
                          ? yield* VacancyRepository.findById(tx, application.vacancyId)
                          : null
                        if (application !== null && vacancy !== null && application.state === "queued") {
                          yield* submitJob(tx, {
                            userId: ctx.userId,
                            hhAccountId: ctx.hhAccountId,
                            applicationId: application.id,
                            vacancyId: vacancy.id,
                            canonicalUrl: vacancy.canonicalUrl,
                            resumeId: application.resumeId ?? null,
                            kit
                          })
                          message = "prepared; submit queued"
                        } else {
                          message = "prepared; waiting for approval"
                        }
                      }
                    } else if (terminalFailure.includes(exit.tag)) {
                      status = "failed"
                      appState = "failed"
                      message = `prepare failed: ${exit.tag}`
                    } else if (needsHuman.includes(exit.tag)) {
                      status = "needs_human"
                      appState = "needs_human"
                      message = `prepare needs a human: ${exit.tag}`
                    } else if (retryable.includes(exit.tag)) {
                      if (job.attempts < job.maxAttempts) {
                        status = "pending"
                        runAt = retryLater(exit, 30)
                        message = `prepare retry ${job.attempts + 1}/${job.maxAttempts}: ${exit.tag}`
                      } else {
                        status = "dead"
                        appState = "needs_human"
                        message = `prepare exhausted retries: ${exit.tag}`
                      }
                    } else {
                      status = "needs_human"
                      appState = "needs_human"
                      message = `prepare finished with unexpected exit: ${exit.tag}`
                    }
                    break
                  }

                  case "submit": {
                    if (
                      exit.tag === "submitted" ||
                      exit.tag === "clicked" ||
                      exit.tag === "already_responded" ||
                      exit.tag === "ambiguous" ||
                      retryable.includes(exit.tag)
                    ) {
                      // The cloud never trusts "submitted"; a reconcile read
                      // is the only thing that can confirm it.
                      status = "needs_reconcile"
                      appState = "submitting"
                      enqueue = "reconcile"
                      message = `submit outcome "${exit.tag}" needs reconcile`
                    } else if (terminalFailure.includes(exit.tag)) {
                      status = "failed"
                      appState = "failed"
                      message = `submit failed: ${exit.tag}`
                    } else if (needsHuman.includes(exit.tag)) {
                      status = "needs_human"
                      appState = "needs_human"
                      message = `submit needs a human: ${exit.tag}`
                    } else {
                      status = "needs_reconcile"
                      appState = "submitting"
                      enqueue = "reconcile"
                      message = `submit outcome "${exit.tag}" needs reconcile`
                    }
                    break
                  }

                  case "reconcile": {
                    if (exit.tag === "submitted" || exit.tag === "already_responded") {
                      status = "done"
                      appState = "submitted"
                      appPatch = { submittedAt: new Date(), lastError: null }
                      message = "response confirmed on the site"
                    } else if (exit.tag === "not_submitted") {
                      status = "failed"
                      appState = "failed"
                      message = "no response on the site"
                    } else if (needsHuman.includes(exit.tag)) {
                      status = "needs_human"
                      appState = "needs_human"
                      message = `reconcile needs a human: ${exit.tag}`
                    } else if (job.attempts < job.maxAttempts) {
                      status = "pending"
                      runAt = retryLater(exit, 60)
                      message = `reconcile retry ${job.attempts + 1}/${job.maxAttempts}: ${exit.tag}`
                    } else {
                      status = "dead"
                      appState = "needs_human"
                      message = `reconcile exhausted retries: ${exit.tag}`
                    }
                    break
                  }

                  case "session": {
                    if (exit.tag === "prepared") {
                      status = "done"
                      message = "session is usable"
                    } else {
                      status = "needs_human"
                      message = `session needs a human: ${exit.tag}`
                    }
                    break
                  }
                }

                const accepted = yield* QueueRepository.complete(tx, {
                  jobId: job.id,
                  leaseId: input.leaseId,
                  epoch: input.epoch,
                  holder: input.harnessId,
                  status,
                  lastError: message,
                  runAt
                })

                if (!accepted) {
                  return ok<CompleteResult>({
                    status: job.status,
                    accepted: false,
                    message: "stale lease"
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
                    yield* ApplicationRepository.finishAttempt(
                      tx,
                      attemptId,
                      exit,
                      exit.artifacts ?? null
                    )
                  }
                }

                if (appState !== null && ctx.applicationId !== null) {
                  yield* ApplicationRepository.transition(
                    tx,
                    ctx.userId,
                    ctx.applicationId,
                    appState,
                    {
                      from:
                        appState === "submitted"
                          ? ["submitting", "needs_human", "failed"]
                          : appState === "submitting"
                            ? ["queued", "submitting"]
                            : appState === "needs_human"
                              ? ["draft", "queued", "submitting", "needs_human", "failed"]
                              : appState === "failed"
                                ? ["draft", "queued", "submitting", "needs_human", "failed"]
                                : ["draft", "queued"],
                      patch: appPatch
                    }
                  )
                }

                if (enqueue === "reconcile" && ctx.applicationId !== null) {
                  const application = yield* ApplicationRepository.findAny(tx, ctx.applicationId)
                  const vacancy = application
                    ? yield* VacancyRepository.findById(tx, application.vacancyId)
                    : null
                  if (application !== null && vacancy !== null && ctx.hhAccountId !== null) {
                    yield* reconcileJob(tx, {
                      userId: ctx.userId,
                      hhAccountId: ctx.hhAccountId,
                      applicationId: application.id,
                      vacancyId: vacancy.id,
                      canonicalUrl: vacancy.canonicalUrl,
                      sequence: yield* nextSequence(tx, application.id, "reconcile")
                    })
                  }
                }

                return ok<CompleteResult>({ status, accepted: true, message })
              })
            )
            .pipe(Effect.mapError(toStorageError("harness.complete")))

          return yield* unwrap(outcome)
        })

      const revoke: QueueServiceShape["revoke"] = (input) =>
        database
          .asUser(currentUser.userId, (tx) =>
            HarnessRepository.revoke(tx, input.harnessId)
          )
          .pipe(
            Effect.map((revoked) => ({ harnessId: input.harnessId as HarnessId, revoked })),
            Effect.mapError(toStorageError("harness.revoke"))
          )

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
  )
}
