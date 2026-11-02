import type { JobStage, KitRecord } from "@otbor/contract"
import { Effect } from "effect"
import type { DatabaseError, Executor } from "../db/Database.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"

/**
 * The three jobs of one application. Idempotency keys are derived from the
 * durable history, not from wall-clock time: a retried command must land on the
 * same row, not mint a second job.
 */

export interface JobTarget {
  readonly userId: string
  readonly hhAccountId: string
  readonly applicationId: string
  readonly vacancyId: string
  readonly canonicalUrl: string
  readonly resumeId?: string | null
}

/** Next sequence number of a stage, so an explicit retry gets a new row. */
export const nextSequence = (
  tx: Executor,
  applicationId: string,
  stage: JobStage
): Effect.Effect<number, DatabaseError> =>
  QueueRepository.countFor(tx, applicationId, stage).pipe(Effect.map((count) => count + 1))

export const prepareJob = (
  tx: Executor,
  input: JobTarget & {
    readonly priority: number
    readonly sequence: number
    readonly runAt?: Date
  }
) => {
  const payload = {
    applicationId: input.applicationId,
    vacancyId: input.vacancyId,
    canonicalUrl: input.canonicalUrl,
    resumeId: input.resumeId
  }

  return QueueRepository.enqueue(tx, {
    userId: input.userId,
    hhAccountId: input.hhAccountId,
    applicationId: input.applicationId,
    stage: "prepare",
    kind: "browser",
    priority: input.priority,
    runAt: input.runAt,
    maxAttempts: 3,
    payload,
    idempotencyKey: `application:${input.applicationId}:prepare:${input.sequence}`
  })
}

export const submitJob = (
  tx: Executor,
  input: JobTarget & { readonly kit: KitRecord }
) => {
  // The kit crosses to the edge with the job. The harness can fill a form and
  // click, but the cloud keeps the only copy of "what was sent" and refuses a
  // second submit for the same application.
  const payload = {
    applicationId: input.applicationId,
    vacancyId: input.vacancyId,
    canonicalUrl: input.canonicalUrl,
    resumeId: input.resumeId,
    kitId: input.kit.id,
    kit: {
      formHash: input.kit.formHash,
      letter: input.kit.letter ?? null,
      answers: input.kit.answers
    }
  }

  return QueueRepository.enqueue(tx, {
    userId: input.userId,
    hhAccountId: input.hhAccountId,
    applicationId: input.applicationId,
    stage: "submit",
    kind: "browser",
    // Submission is the rarest and most expensive step: it goes first.
    priority: 1_000,
    maxAttempts: 1,
    payload,
    // Constant on purpose: a second submit job for the same application can
    // never exist, whatever the caller does.
    idempotencyKey: `application:${input.applicationId}:submit`
  })
}

export const reconcileJob = (
  tx: Executor,
  input: JobTarget & { readonly sequence: number; readonly runAt?: Date }
) => {
  const payload = {
    applicationId: input.applicationId,
    vacancyId: input.vacancyId,
    canonicalUrl: input.canonicalUrl
  }

  return QueueRepository.enqueue(tx, {
    userId: input.userId,
    hhAccountId: input.hhAccountId,
    applicationId: input.applicationId,
    stage: "reconcile",
    kind: "browser",
    priority: 500,
    maxAttempts: 3,
    runAt: input.runAt ?? new Date(Date.now() + 30_000),
    payload,
    idempotencyKey: `application:${input.applicationId}:reconcile:${input.sequence}`
  })
}
