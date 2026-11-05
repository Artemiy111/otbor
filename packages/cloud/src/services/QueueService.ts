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
import { parseResponseForm } from "@otbor/hh"
import { sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { generateHarnessToken, hashHarnessToken } from "../auth/harnessToken.ts"
import { Database } from "../db/Database.ts"
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
import * as HhAccountRepository from "../repositories/HhAccountRepository.ts"
import * as HarnessRepository from "../repositories/HarnessRepository.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { CurrentUser } from "./CurrentUser.ts"
import {
  attemptArtifacts,
  checkKit,
  judgePrepare,
  judgeReconcile,
  judgeNegotiationsSync,
  judgeResumeSync,
  judgeSubmit,
  reconcileArtifacts
} from "./applyRules.ts"
import { completeFitInference } from "./fitJudge.ts"
import * as VacancyFormRepository from "../repositories/VacancyFormRepository.ts"
import { hintsFor } from "./formHints.ts"
import { importTopics } from "./NegotiationsSync.ts"
import { importResumes } from "./ResumeSync.ts"
import { negotiationsSyncJob, nextSequence, reconcileJob, submitJob, targetFor } from "./jobs.ts"
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

export class QueueService extends Context.Service<QueueService, QueueServiceShape>()(
  "otbor/cloud/QueueService"
) {
  static readonly layer = Layer.effect(
    QueueService,
    Effect.gen(function*() {
      const database = yield* Database
      const currentUser = yield* CurrentUser

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
                let status: JobStatus = "done"
                let message: string | null = null
                let runAt: Date | null | undefined
                let appState:
                  | "draft"
                  | "queued"
                  | "submitting"
                  | "submitted"
                  | "skipped"
                  | "needs_human"
                  | "failed"
                  | null = null
                let appPatch: Record<string, unknown> = {}
                let enqueue: "reconcile" | "submit" | null = null
                let jobResult: unknown
                /** Reconcile: what the cloud read, kept on the attempt instead of the pages. */
                let reconcileKept: Record<string, unknown> | null = null
                /** Reconcile: how the parked submit job is closed once the application moves. */
                let settle: {
                  readonly status: "done" | "failed"
                  readonly result: unknown
                  readonly message: string
                } | null = null

                switch (job.stage) {
                  case "prepare": {
                    // Replaced by `form_read`; a leftover job reads nothing.
                    status = "cancelled"
                    message = "prepare is replaced by form_read"
                    break
                  }

                  case "form_read": {
                    // The form belongs to the vacancy: every applicant sees the
                    // same questions. The harness delivers the page, the cloud
                    // parses it and keeps one version per distinct form.
                    const verdict = judgePrepare(exit)
                    const wanted = (job.payload as { vacancyId?: unknown } | null)?.vacancyId
                    const vacancy =
                      typeof wanted === "string"
                        ? yield* VacancyRepository.findById(tx, wanted)
                        : null
                    const waiting =
                      vacancy === null
                        ? []
                        : yield* ApplicationRepository.list(tx, ctx.userId, {
                            state: "queued",
                            vacancyId: vacancy.id
                          })
                    /** An application auto-queued for this form cannot wait for a read that failed. */
                    const parkWaiting = (state: "needs_human" | "skipped", reason: string) =>
                      Effect.forEach(waiting, (application) =>
                        ApplicationRepository.transition(tx, ctx.userId, application.id, state, {
                          from: ["queued"],
                          patch: { lastError: reason }
                        })
                      )

                    if (vacancy === null) {
                      status = "failed"
                      message = "form read, but the vacancy is gone"
                    } else if (verdict._tag === "form") {
                      const form = parseResponseForm(verdict.artifacts.html, verdict.artifacts.url)
                      if (form.vacancyId !== "" && form.vacancyId !== vacancy.externalId) {
                        status = "needs_human"
                        message = "the harness returned the form of another vacancy"
                        yield* VacancyFormRepository.recordFailure(tx, {
                          vacancyId: vacancy.id,
                          message
                        })
                        yield* parkWaiting("needs_human", message)
                      } else if (form.layout === "unknown") {
                        status = "needs_human"
                        message = "the response form layout was not recognized"
                        yield* VacancyFormRepository.recordUnreadable(tx, {
                          vacancyId: vacancy.id,
                          accountId: ctx.hhAccountId,
                          message
                        })
                        yield* parkWaiting("needs_human", message)
                      } else {
                        const recorded = yield* VacancyFormRepository.recordRead(tx, {
                          vacancyId: vacancy.id,
                          accountId: ctx.hhAccountId,
                          status: form.questions.length === 0 ? "none" : "present",
                          form,
                          url: verdict.artifacts.url
                        })
                        message = recorded.changed ? "form read; the form changed" : "form read; unchanged"
                        // Auto-queued applications whose kit fits this form go out now.
                        for (const application of waiting) {
                          const kit = yield* ApplicationRepository.findKit(tx, application.id, form.formHash)
                          if (kit === null) continue
                          if ((yield* QueueRepository.latestFor(tx, application.id, ["submit"])) !== null) continue
                          const hints = yield* hintsFor(tx, application, form)
                          const problems = checkKit({ form, hints, kit })
                          if (problems.length > 0) {
                            yield* ApplicationRepository.transition(
                              tx,
                              ctx.userId,
                              application.id,
                              "needs_human",
                              {
                                from: ["queued"],
                                patch: {
                                  lastError: `kit refused: ${problems.map((problem) => problem.code).join(", ")}`
                                }
                              }
                            )
                            continue
                          }
                          const target = yield* targetFor(tx, application)
                          if (target !== null) {
                            yield* submitJob(tx, {
                              ...target,
                              kit,
                              form,
                              sequence: yield* nextSequence(tx, application.id, "submit")
                            })
                          }
                        }
                      }
                    } else if (verdict._tag === "skip") {
                      status = "done"
                      message = `form read skipped: ${verdict.reason}`
                      if (verdict.reason.includes("archived")) {
                        yield* VacancyFormRepository.recordRead(tx, {
                          vacancyId: vacancy.id,
                          accountId: ctx.hhAccountId,
                          status: "gone",
                          form: null,
                          url: null
                        })
                      } else {
                        yield* VacancyFormRepository.recordFailure(tx, {
                          vacancyId: vacancy.id,
                          message: verdict.reason
                        })
                      }
                      yield* parkWaiting("skipped", verdict.reason)
                      if (exit.tag === "already_responded" && ctx.hhAccountId !== null) {
                        // hh knows a response otbor does not: import it, so the
                        // vacancy shows "responded" instead of a form error.
                        const latest = yield* QueueRepository.latestForAccount(
                          tx,
                          ctx.hhAccountId,
                          "negotiations_sync"
                        )
                        if (latest === null || !["pending", "leased", "running"].includes(latest.job.status)) {
                          const profile = (job.payload as { sessionProfile?: unknown } | null)?.sessionProfile
                          yield* negotiationsSyncJob(tx, {
                            userId: ctx.userId,
                            hhAccountId: ctx.hhAccountId,
                            sessionProfile: typeof profile === "string" ? profile : null,
                            sequence:
                              (yield* QueueRepository.countForAccount(tx, ctx.hhAccountId, "negotiations_sync")) + 1
                          })
                        }
                      }
                    } else if (verdict._tag === "human") {
                      status = "needs_human"
                      message = `form read needs a human: ${verdict.reason}`
                      yield* VacancyFormRepository.recordFailure(tx, { vacancyId: vacancy.id, message })
                      yield* parkWaiting("needs_human", verdict.reason)
                    } else if (verdict._tag === "failed") {
                      status = "failed"
                      message = verdict.reason
                      yield* VacancyFormRepository.recordFailure(tx, { vacancyId: vacancy.id, message })
                      yield* parkWaiting("needs_human", verdict.reason)
                    } else if (job.attempts < job.maxAttempts) {
                      status = "pending"
                      runAt = retryLater(exit, 30)
                      message = `form read retry ${job.attempts + 1}/${job.maxAttempts}: ${exit.tag}`
                    } else {
                      status = "dead"
                      message = `form read exhausted retries: ${exit.tag}`
                      yield* VacancyFormRepository.recordFailure(tx, { vacancyId: vacancy.id, message })
                      yield* parkWaiting("needs_human", message)
                    }
                    break
                  }

                  case "submit": {
                    // The harness reports a claim, the cloud decides from the
                    // evidence. Only a page the cloud itself reads as "you
                    // responded" settles a submit; anything that might have
                    // reached hh goes to reconcile and is never sent again.
                    const verdict = judgeSubmit(exit)
                    if (verdict._tag === "submitted") {
                      status = "done"
                      appState = "submitted"
                      appPatch = { submittedAt: new Date(), lastError: null }
                      message = "submitted; the response page confirmed it"
                      jobResult = { clicked: true, verified: "page" }
                    } else if (verdict._tag === "not_sent") {
                      status = verdict.app === "failed" ? "failed" : "needs_human"
                      appState = verdict.app
                      appPatch = { lastError: verdict.reason }
                      message = `submit not sent: ${verdict.tag}`
                      jobResult = { clicked: false, tag: verdict.tag }
                    } else {
                      status = "needs_reconcile"
                      appState = "submitting"
                      enqueue = "reconcile"
                      message = verdict.reason
                      jobResult = { clicked: null }
                    }
                    break
                  }

                  case "reconcile": {
                    // The harness only reports the pages it read. The cloud
                    // parses them and decides; a bare tag settles nothing, and
                    // no verdict here can queue a second submit.
                    const application =
                      ctx.applicationId === null
                        ? null
                        : yield* ApplicationRepository.findAny(tx, ctx.applicationId)
                    const vacancy = application
                      ? yield* VacancyRepository.findById(tx, application.vacancyId)
                      : null
                    if (application === null || vacancy === null) {
                      status = "failed"
                      appState = "failed"
                      message = "reconciled, but the application or vacancy is gone"
                      break
                    }

                    const verdict = judgeReconcile(exit, vacancy.externalId)
                    reconcileKept = reconcileArtifacts(exit, verdict)
                    if (verdict._tag === "submitted") {
                      status = "done"
                      appState = "submitted"
                      appPatch = { submittedAt: new Date(), lastError: null }
                      message = `reconciled: ${verdict.reason}`
                      jobResult = { found: true, reading: verdict.reading }
                      settle = {
                        status: "done",
                        result: { clicked: true, verified: "reconcile" },
                        message
                      }
                    } else if (verdict._tag === "unsent") {
                      // Provably no response: back to draft so a person looks
                      // again and approves again. Nothing is queued here.
                      status = "done"
                      appState = "draft"
                      message = `reconciled: ${verdict.reason}`
                      appPatch = {
                        lastError: "the response did not reach hh; approve again to send it"
                      }
                      jobResult = { found: false, reading: verdict.reading }
                      settle = {
                        status: "failed",
                        result: { clicked: false, reconciled: true },
                        message
                      }
                    } else if (verdict._tag === "human") {
                      status = "needs_human"
                      appState = "needs_human"
                      message = `reconcile needs a human: ${verdict.reason}`
                      appPatch = { lastError: verdict.reason }
                    } else if (job.attempts < job.maxAttempts) {
                      status = "pending"
                      runAt = retryLater(exit, 60)
                      message = `reconcile retry ${job.attempts + 1}/${job.maxAttempts}: ${verdict.reason}`
                    } else {
                      status = "dead"
                      appState = "needs_human"
                      message = `reconcile exhausted retries: ${verdict.reason}`
                      appPatch = {
                        lastError: `could not confirm whether the response was sent: ${verdict.reason}`
                      }
                    }
                    break
                  }

                  case "negotiations_sync": {
                    // The harness only delivers pages. The cloud reads them and
                    // imports; nothing here touches an application of origin otbor.
                    const verdict = judgeNegotiationsSync(exit)
                    if (verdict._tag === "read" && ctx.hhAccountId !== null) {
                      const imported = yield* importTopics(tx, {
                        userId: ctx.userId,
                        hhAccountId: ctx.hhAccountId,
                        topics: verdict.topics,
                        pages: verdict.pages,
                        complete: verdict.complete
                      })
                      status = "done"
                      jobResult = { counts: imported.counts }
                      message = `negotiations synced: ${imported.counts.imported} imported, ${imported.counts.updated} updated, ${imported.counts.unknownVacancy} unknown vacancy${verdict.complete ? "" : " (list not read to the end)"}`
                    } else if (verdict._tag === "human") {
                      status = "needs_human"
                      message = `negotiations sync needs a human: ${verdict.reason}`
                    } else if (verdict._tag === "read" || job.attempts >= job.maxAttempts) {
                      status = "dead"
                      message = `negotiations sync gave up: ${verdict._tag === "read" ? "job has no account" : verdict.reason}`
                    } else {
                      status = "pending"
                      runAt = retryLater(exit, 120)
                      message = `negotiations sync retry ${job.attempts + 1}/${job.maxAttempts}: ${verdict.reason}`
                    }
                    break
                  }

                  case "resume_sync": {
                    // The harness only delivers pages. The cloud reads them and
                    // stores the resumes; the operator's enrichment is untouched.
                    const verdict = judgeResumeSync(exit)
                    if (verdict._tag === "read" && ctx.hhAccountId !== null) {
                      const counts = yield* importResumes(tx, {
                        userId: ctx.userId,
                        hhAccountId: ctx.hhAccountId,
                        found: verdict.found,
                        resumes: verdict.resumes,
                        unreadable: verdict.unreadable
                      })
                      status = "done"
                      jobResult = { counts }
                      message = `resumes synced: ${counts.imported} imported, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.unreadable} unreadable`
                    } else if (verdict._tag === "human") {
                      status = "needs_human"
                      message = `resume sync needs a human: ${verdict.reason}`
                    } else if (verdict._tag === "read" || job.attempts >= job.maxAttempts) {
                      status = "dead"
                      message = `resume sync gave up: ${verdict._tag === "read" ? "job has no account" : verdict.reason}`
                    } else {
                      status = "pending"
                      runAt = retryLater(exit, 120)
                      message = `resume sync retry ${job.attempts + 1}/${job.maxAttempts}: ${verdict.reason}`
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

                  case "inference": {
                    if (exit.tag === "prepared") {
                      status = "done"
                      jobResult = exit.artifacts ?? null
                      message = "inference completed"
                    } else if (terminalFailure.includes(exit.tag)) {
                      status = "failed"
                      message = `inference failed: ${exit.tag}`
                    } else if (needsHuman.includes(exit.tag)) {
                      status = "needs_human"
                      message = `inference needs a human: ${exit.tag}`
                    } else if (retryable.includes(exit.tag)) {
                      if (job.attempts < job.maxAttempts) {
                        status = "pending"
                        runAt = retryLater(exit, 15)
                        message = `inference retry ${job.attempts + 1}/${job.maxAttempts}: ${exit.tag}`
                      } else {
                        status = "dead"
                        message = `inference exhausted retries: ${exit.tag}`
                      }
                    } else {
                      status = "needs_human"
                      message = `inference finished with unexpected exit: ${exit.tag}`
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
                  result: jobResult,
                  runAt
                })

                if (!accepted) {
                  return ok<CompleteResult>({
                    status: job.status,
                    accepted: false,
                    message: "stale lease"
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
                      from:
                        appState === "submitted"
                          ? ["submitting", "needs_human", "failed"]
                          : appState === "submitting"
                            ? ["queued", "submitting"]
                            : appState === "needs_human"
                              ? ["draft", "queued", "submitting", "needs_human", "failed"]
                              : appState === "failed"
                                ? ["draft", "queued", "submitting", "needs_human", "failed"]
                                : appState === "draft" && job.stage === "reconcile"
                                  ? ["submitting", "needs_human", "failed"]
                                  : ["draft", "queued"],
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

                return ok<CompleteResult>({ status, accepted: true, message })
              })
            )
            .pipe(Effect.mapError(toStorageError("harness.complete")))

          return yield* unwrap(outcome)
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
  )
}
