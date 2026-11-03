import type {
  ApplicationRecord,
  FormAnswer,
  FormQuestion,
  InferencePayload,
  JobStage,
  KitRecord
} from "@otbor/contract"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseError, Executor } from "../db/Database.ts"
import * as QueueRepository from "../repositories/QueueRepository.ts"
import * as VacancyRepository from "../repositories/VacancyRepository.ts"
import { toFormAnswers } from "./applyRules.ts"

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
  /** hh external vacancy id: the `vacancyId` of the response page. */
  readonly externalId: string
  /** Local browser profile of the account's hh session, if one is linked. */
  readonly sessionProfile?: string | null
}

/**
 * Everything a browser job needs to know about its application: the vacancy
 * (external id, canonical URL) and the account's linked session profile.
 */
export const targetFor = (
  tx: Executor,
  application: ApplicationRecord
): Effect.Effect<JobTarget | null, DatabaseError> =>
  Effect.gen(function*() {
    const vacancy = yield* VacancyRepository.findById(tx, application.vacancyId)
    if (vacancy === null) return null
    const profile = yield* tx.execute(
      sql`select session_profile from hh_account where id = ${application.hhAccountId} limit 1`
    )
    return {
      userId: application.userId,
      hhAccountId: application.hhAccountId,
      applicationId: application.id,
      vacancyId: vacancy.id,
      canonicalUrl: vacancy.canonicalUrl,
      resumeId: application.resumeId ?? null,
      externalId: vacancy.externalId,
      sessionProfile: (profile.rows[0]?.session_profile as string | null | undefined) ?? null
    }
  })

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
    externalId: input.externalId,
    sessionProfile: input.sessionProfile ?? null,
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
  input: JobTarget & {
    readonly kit: KitRecord
    /** 1 for the first submit of an application; later only after a provably unsent one. */
    readonly sequence?: number
    /** Form questions, to bring a legacy kit to `FormAnswer[]`. */
    readonly form?: { readonly questions: ReadonlyArray<FormQuestion> } | null
  }
) => {
  // The kit crosses to the edge with the job. The harness can fill a form and
  // click, but the cloud keeps the only copy of "what was sent" and refuses a
  // second submit for the same application.
  const answers: ReadonlyArray<FormAnswer> = toFormAnswers(input.form ?? null, input.kit.answers)
  const payload = {
    applicationId: input.applicationId,
    vacancyId: input.vacancyId,
    canonicalUrl: input.canonicalUrl,
    externalId: input.externalId,
    sessionProfile: input.sessionProfile ?? null,
    resumeId: input.resumeId,
    kitId: input.kit.id,
    expectedFormHash: input.kit.formHash,
    kit: {
      formHash: input.kit.formHash,
      letter: input.kit.letter ?? null,
      answers
    }
  }

  const sequence = input.sequence ?? 1
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
    // Constant for the first submit on purpose: a second submit job for the
    // same application can never exist unless the first one is provably unsent
    // (see `ApplicationService.approve`), whatever the caller does.
    idempotencyKey:
      sequence <= 1
        ? `application:${input.applicationId}:submit`
        : `application:${input.applicationId}:submit:${sequence}`
  })
}

export const reconcileJob = (
  tx: Executor,
  input: JobTarget & { readonly sequence: number; readonly runAt?: Date }
) => {
  const payload = {
    applicationId: input.applicationId,
    vacancyId: input.vacancyId,
    canonicalUrl: input.canonicalUrl,
    externalId: input.externalId,
    sessionProfile: input.sessionProfile ?? null
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

/**
 * An ACP prompt as a queue job. The harness owns the actual agent process; the
 * cloud only stores the request and the result.
 */
export const inferenceJob = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string | null
    readonly payload: InferencePayload
    readonly idempotencyKey: string
    readonly priority?: number
  }
) =>
  QueueRepository.enqueue(tx, {
    userId: input.userId,
    hhAccountId: input.hhAccountId,
    applicationId: null,
    stage: "inference",
    kind: "inference",
    priority: input.priority ?? 100,
    maxAttempts: 3,
    payload: {
      prompt: input.payload.prompt,
      ...(input.payload.system === undefined ? {} : { system: input.payload.system }),
      ...(input.payload.model === undefined ? {} : { model: input.payload.model }),
      ...(input.payload.jsonSchema === undefined ? {} : { jsonSchema: input.payload.jsonSchema })
    },
    idempotencyKey: input.idempotencyKey
  })
