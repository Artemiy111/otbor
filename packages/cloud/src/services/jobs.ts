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
import * as ApplicationRepository from "../repositories/ApplicationRepository.ts"
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
  /** Title of that resume: только для сообщений, выбирает харнес по id. */
  readonly resumeTitle?: string | null
  /** Числовой id резюме на hh (`resume.external_id`): по нему харнес выбирает резюме в форме. */
  readonly resumeExternalId?: string | null
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
    const resume =
      application.resumeId === null || application.resumeId === undefined
        ? null
        : yield* tx.execute(sql`select title, external_id from resume where id = ${application.resumeId} limit 1`)
    return {
      userId: application.userId,
      hhAccountId: application.hhAccountId,
      applicationId: application.id,
      vacancyId: vacancy.id,
      canonicalUrl: vacancy.canonicalUrl,
      resumeId: application.resumeId ?? null,
      resumeTitle: (resume?.rows[0]?.title as string | null | undefined) ?? null,
      resumeExternalId: (resume?.rows[0]?.external_id as string | null | undefined) ?? null,
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

/**
 * Reads the response form of a vacancy. Not tied to an application: the
 * account only lends its hh session. Callers deduplicate against a form read
 * that is already queued (`requestFormRead`), so the key is just unique.
 */
export const formReadJob = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly vacancyId: string
    readonly externalId: string
    readonly canonicalUrl: string
    readonly sessionProfile: string | null
    readonly priority: number
  }
) =>
  QueueRepository.enqueue(tx, {
    userId: input.userId,
    hhAccountId: input.hhAccountId,
    applicationId: null,
    stage: "form_read",
    kind: "browser",
    priority: input.priority,
    maxAttempts: 3,
    payload: {
      vacancyId: input.vacancyId,
      externalId: input.externalId,
      canonicalUrl: input.canonicalUrl,
      sessionProfile: input.sessionProfile
    },
    idempotencyKey: `vacancy:${input.vacancyId}:form_read:${Date.now()}`
  })

export const submitJob = (
  tx: Executor,
  input: JobTarget & {
    readonly kit: KitRecord
    /** 1 for the first submit of an application; later only after a provably unsent one. */
    readonly sequence?: number
    /** Автоотклик: харнес делает разминку перед кликом. */
    readonly humanize?: boolean
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
    resumeTitle: input.resumeTitle ?? null,
    resumeExternalId: input.resumeExternalId ?? null,
    humanize: input.humanize === true,
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
) => Effect.gen(function*() {
  // Список откликов нужен, только если страница вакансии не скажет, с каким
  // резюме сделан отклик: у аккаунта есть другая заявка на вакансию с другим резюме.
  const needsResume = yield* ApplicationRepository.hasOtherResumeApplication(tx, input.applicationId)
  const payload = {
    needsResume,
    resumeExternalId: input.resumeExternalId ?? null,
    applicationId: input.applicationId,
    vacancyId: input.vacancyId,
    canonicalUrl: input.canonicalUrl,
    externalId: input.externalId,
    sessionProfile: input.sessionProfile ?? null
  }

  return yield* QueueRepository.enqueue(tx, {
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
})

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
      ...(input.payload.jsonSchema === undefined ? {} : { jsonSchema: input.payload.jsonSchema }),
      ...(input.payload.harness === undefined ? {} : { harness: input.payload.harness }),
      ...(input.payload.effort === undefined ? {} : { effort: input.payload.effort })
    },
    idempotencyKey: input.idempotencyKey
  })

/**
 * Reads the account's negotiations list. Not tied to an application: the
 * account is the target. Callers pass a fresh `sequence` for an explicit rerun.
 */
export const negotiationsSyncJob = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly sessionProfile: string | null
    readonly sequence: number
    readonly maxPages?: number
  }
) =>
  QueueRepository.enqueue(tx, {
    userId: input.userId,
    hhAccountId: input.hhAccountId,
    applicationId: null,
    stage: "negotiations_sync",
    kind: "browser",
    // Background bookkeeping: behind every prepare, submit and reconcile.
    priority: 10,
    maxAttempts: 3,
    payload: {
      hhAccountId: input.hhAccountId,
      sessionProfile: input.sessionProfile,
      ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages })
    },
    idempotencyKey: `account:${input.hhAccountId}:negotiations_sync:${input.sequence}`
  })

/**
 * Reads the account's resumes. Not tied to an application: the account is the
 * target. Callers pass a fresh `sequence` for an explicit rerun.
 */
export const resumeSyncJob = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly sessionProfile: string | null
    readonly sequence: number
    readonly maxResumes?: number
  }
) =>
  QueueRepository.enqueue(tx, {
    userId: input.userId,
    hhAccountId: input.hhAccountId,
    applicationId: null,
    stage: "resume_sync",
    kind: "browser",
    // Background bookkeeping: behind every prepare, submit and reconcile.
    priority: 10,
    maxAttempts: 3,
    payload: {
      hhAccountId: input.hhAccountId,
      sessionProfile: input.sessionProfile,
      ...(input.maxResumes === undefined ? {} : { maxResumes: input.maxResumes })
    },
    idempotencyKey: `account:${input.hhAccountId}:resume_sync:${input.sequence}`
  })

/**
 * Adds a cover letter to a response hh already holds. One attempt only. The
 * caller decides whether a new job is allowed (nothing active, nothing sent).
 */
export const letterAttachJob = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly vacancyId: string
    readonly externalId: string
    readonly canonicalUrl: string
    readonly sessionProfile: string | null
    readonly letter: string
    readonly letterHash: string
    /** The hh chat of the response, when it is known. */
    readonly chatId: string | null
    /** Grows with every earlier job of this vacancy and account, so a failed try can be redone. */
    readonly sequence: number
  }
) =>
  QueueRepository.enqueue(tx, {
    userId: input.userId,
    hhAccountId: input.hhAccountId,
    applicationId: null,
    stage: "letter_attach",
    kind: "browser",
    priority: 5,
    maxAttempts: 1,
    payload: {
      vacancyId: input.vacancyId,
      externalId: input.externalId,
      canonicalUrl: input.canonicalUrl,
      sessionProfile: input.sessionProfile,
      letter: input.letter,
      chatId: input.chatId
    },
    idempotencyKey: `vacancy:${input.vacancyId}:account:${input.hhAccountId}:chat:${input.chatId ?? "none"}:letter_attach:${input.letterHash}:${input.sequence}`
  })

/**
 * Reads one hh chat (the chat of one response). Read-only and repeatable: a
 * caller passes a fresh `sequence` for every explicit refresh.
 */
export const chatReadJob = (
  tx: Executor,
  input: {
    readonly userId: string
    readonly hhAccountId: string
    readonly vacancyId: string
    readonly chatId: string
    readonly sessionProfile: string | null
    readonly sequence: number
  }
) =>
  QueueRepository.enqueue(tx, {
    userId: input.userId,
    hhAccountId: input.hhAccountId,
    applicationId: null,
    stage: "chat_read",
    kind: "browser",
    // The operator is looking at the page: ahead of background bookkeeping.
    priority: 5,
    maxAttempts: 3,
    payload: {
      hhAccountId: input.hhAccountId,
      vacancyId: input.vacancyId,
      chatId: input.chatId,
      sessionProfile: input.sessionProfile
    },
    idempotencyKey: `vacancy:${input.vacancyId}:account:${input.hhAccountId}:chat:${input.chatId}:chat_read:${input.sequence}`
  })
