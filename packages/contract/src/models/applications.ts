import { Schema } from "effect"
import { ApplicationOrigin, ApplicationState, AttemptStage, HarnessExitTag } from "../enums.ts"
import { FormAnswer, ResponseForm, StoredForm } from "../form.ts"
import {
  ApplicationId,
  AttemptId,
  DecisionId,
  HarnessId,
  HhAccountId,
  KitId,
  ResumeId,
  UserId,
  VacancyId
} from "../ids.ts"
import { DecisionRecord } from "./lexicon.ts"

export const Answer = Schema.Struct({
  question: Schema.String,
  answer: Schema.String
})

export type Answer = typeof Answer.Type

export const ApplicationRecord = Schema.Struct({
  id: ApplicationId,
  userId: UserId,
  hhAccountId: HhAccountId,
  vacancyId: VacancyId,
  vacancyTitle: Schema.optional(Schema.String),
  employerName: Schema.optional(Schema.NullOr(Schema.String)),
  resumeId: Schema.optional(Schema.NullOr(ResumeId)),
  streamId: Schema.optional(Schema.NullOr(Schema.String)),
  decisionId: Schema.optional(Schema.NullOr(DecisionId)),
  state: ApplicationState,
  origin: Schema.optional(ApplicationOrigin),
  /** hh's own negotiation state, for imported applications. */
  hhStatus: Schema.optional(Schema.NullOr(Schema.String)),
  hhRespondedAt: Schema.optional(Schema.NullOr(Schema.String)),
  /** `drafts` / `auto` when the auto-apply runner made this application; null for a manual one. */
  autoRun: Schema.optional(Schema.NullOr(Schema.Literals(["drafts", "auto"]))),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type ApplicationRecord = typeof ApplicationRecord.Type

/** What the last negotiations sync of an account did. Counts only; no page bodies. */
export const NegotiationsSyncCounts = Schema.Struct({
  pages: Schema.Int,
  topics: Schema.Int,
  imported: Schema.Int,
  updated: Schema.Int,
  /** Already an application of otbor's own, or nothing changed. */
  unchanged: Schema.Int,
  /** In the list, but not in the corpus yet: ingest the vacancy, then sync again. */
  unknownVacancy: Schema.Int,
  /** The first external ids of those vacancies. */
  unknownVacancyIds: Schema.optional(Schema.Array(Schema.String)),
  /** Every page readable and the list read to its end. */
  complete: Schema.Boolean
})

export type NegotiationsSyncCounts = typeof NegotiationsSyncCounts.Type

export const NegotiationsSyncStatus = Schema.Struct({
  hhAccountId: HhAccountId,
  jobId: Schema.optional(Schema.NullOr(Schema.String)),
  /** `none` when the account was never synced. */
  status: Schema.Literals(["none", "pending", "running", "done", "failed", "needs_human"]),
  message: Schema.optional(Schema.NullOr(Schema.String)),
  requestedAt: Schema.optional(Schema.NullOr(Schema.String)),
  finishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  counts: Schema.optional(Schema.NullOr(NegotiationsSyncCounts))
})

export type NegotiationsSyncStatus = typeof NegotiationsSyncStatus.Type

/** What the last resume sync of an account did. Counts only; no page bodies. */
export const ResumeSyncCounts = Schema.Struct({
  /** Resume cards on the profile page. */
  found: Schema.Int,
  /** New resumes stored. */
  imported: Schema.Int,
  /** Stored resumes whose content changed. */
  updated: Schema.Int,
  unchanged: Schema.Int,
  /** Cards whose page could not be read. */
  unreadable: Schema.Int,
  /** Stored resumes that are no longer on the profile, now inactive. */
  deactivated: Schema.Int
})

export type ResumeSyncCounts = typeof ResumeSyncCounts.Type

export const ResumeSyncStatus = Schema.Struct({
  hhAccountId: HhAccountId,
  jobId: Schema.optional(Schema.NullOr(Schema.String)),
  /** `none` when the account was never synced. */
  status: Schema.Literals(["none", "pending", "running", "done", "failed", "needs_human"]),
  message: Schema.optional(Schema.NullOr(Schema.String)),
  requestedAt: Schema.optional(Schema.NullOr(Schema.String)),
  finishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  counts: Schema.optional(Schema.NullOr(ResumeSyncCounts))
})

export type ResumeSyncStatus = typeof ResumeSyncStatus.Type

/** A kit holds structured answers; kits saved before the form parser hold `Answer`. */
export const KitAnswer = Schema.Union([FormAnswer, Answer])

export type KitAnswer = typeof KitAnswer.Type

export const KitRecord = Schema.Struct({
  id: KitId,
  applicationId: ApplicationId,
  formHash: Schema.String,
  letter: Schema.optional(Schema.NullOr(Schema.String)),
  answers: Schema.Array(KitAnswer),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  promptHash: Schema.optional(Schema.NullOr(Schema.String)),
  costUsd: Schema.optional(Schema.NullOr(Schema.Number)),
  createdAt: Schema.String
})

export type KitRecord = typeof KitRecord.Type

export const HarnessExit = Schema.Struct({
  tag: HarnessExitTag,
  message: Schema.optional(Schema.String),
  retryAfterSeconds: Schema.optional(Schema.Int),
  formHash: Schema.optional(Schema.String),
  artifacts: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
})

export type HarnessExit = typeof HarnessExit.Type

export const AttemptRecord = Schema.Struct({
  id: AttemptId,
  applicationId: ApplicationId,
  seq: Schema.Int,
  stage: AttemptStage,
  harnessId: Schema.optional(Schema.NullOr(HarnessId)),
  exit: Schema.optional(Schema.NullOr(HarnessExit)),
  startedAt: Schema.String,
  finishedAt: Schema.optional(Schema.NullOr(Schema.String))
})

export type AttemptRecord = typeof AttemptRecord.Type

export const ApplicationDetail = Schema.Struct({
  application: ApplicationRecord,
  kit: Schema.optional(Schema.NullOr(KitRecord)),
  form: Schema.optional(Schema.NullOr(StoredForm)),
  attempts: Schema.Array(AttemptRecord),
  decision: Schema.optional(Schema.NullOr(DecisionRecord))
})

export type ApplicationDetail = typeof ApplicationDetail.Type

/**
 * The response form of a vacancy as hh shows it now, the same for every
 * applicant. `unknown`: never read. `none`: hh shows no questions. `unreadable`:
 * the layout was not recognized, which is never "no questions". `gone`: the
 * vacancy is archived.
 */
export const VacancyFormStatus = Schema.Literals(["unknown", "none", "present", "unreadable", "gone"])

export type VacancyFormStatus = typeof VacancyFormStatus.Type

export const VacancyFormState = Schema.Struct({
  vacancyId: VacancyId,
  status: VacancyFormStatus,
  /** The current version, null until a form was read. */
  form: Schema.NullOr(ResponseForm),
  url: Schema.NullOr(Schema.String),
  /** Last successful read. */
  checkedAt: Schema.NullOr(Schema.String),
  /** When the current version last changed. */
  changedAt: Schema.NullOr(Schema.String),
  /** Older than a day, or never read: worth refreshing before it is relied on. */
  stale: Schema.Boolean,
  /** A form read is queued or running. */
  reading: Schema.Boolean,
  /** Why the latest read failed, if it did. */
  lastError: Schema.NullOr(Schema.String),
  /** How many versions of the form were seen. */
  versions: Schema.Int
})

export type VacancyFormState = typeof VacancyFormState.Type

/* -------------------------------------------------------------------------- */

/**
 * The newest "attach a cover letter to the response" job of a vacancy for an
 * account. `sent`: hh closed the letter dialog after the send click.
 * `needs_human`: the click may have reached hh, check the response there.
 */
export const LetterAttachStatus = Schema.Struct({
  status: Schema.Literals(["none", "pending", "running", "sent", "failed", "needs_human"]),
  message: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String),
  /** The text of the newest job, so the operator can read what was sent. */
  letter: Schema.NullOr(Schema.String)
})

export type LetterAttachStatus = typeof LetterAttachStatus.Type

/** The unsent cover letter kept for a response (account + vacancy + resume). */
export const LetterDraft = Schema.Struct({
  letter: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String)
})

export type LetterDraft = typeof LetterDraft.Type
