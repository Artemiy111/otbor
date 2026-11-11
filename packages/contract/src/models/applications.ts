import { Schema } from "effect"
import { ApplicationOrigin, ApplicationState, BlockedReason, AttemptStage, HarnessExitTag } from "../enums.ts"
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
  /** Типизированная причина остановки; текст для человека лежит в `lastError`. */
  blockedReason: Schema.optional(Schema.NullOr(BlockedReason)),
  /** Когда раннер возобновит ждущий автоотклик (`preparing`). */
  retryAt: Schema.optional(Schema.NullOr(Schema.String)),
  /** Сколько автоповторов уже потрачено (письмо, чтение формы). */
  autoRetries: Schema.optional(Schema.Int),
  /** Есть ли в ките непустое сопроводительное письмо; `null`, пока кита нет. */
  hasLetter: Schema.optional(Schema.NullOr(Schema.Boolean)),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type ApplicationRecord = typeof ApplicationRecord.Type

/** Страница откликов по фильтру: строки, сколько всего подошло и сколько откликов в каждом состоянии. */
export const ApplicationsSearchResult = Schema.Struct({
  items: Schema.Array(ApplicationRecord),
  /** Всего откликов, подходящих под фильтр (не только на этой странице). */
  total: Schema.Int,
  /** Отклики аккаунта (или всех аккаунтов) по состояниям, без учёта остальных фильтров: счётчики вкладок. */
  byState: Schema.Record(Schema.String, Schema.Int)
})

export type ApplicationsSearchResult = typeof ApplicationsSearchResult.Type

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

/** How the letter was written: from the inference job behind the kit. Every field may be unknown. */
export const KitWriting = Schema.Struct({
  harness: Schema.NullOr(Schema.String),
  /** The alias the job asked for ("haiku"). */
  model: Schema.NullOr(Schema.String),
  /** The provider's full model id ("claude-haiku-5-5"), when it reported one. */
  modelId: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  inputTokens: Schema.NullOr(Schema.Int),
  outputTokens: Schema.NullOr(Schema.Int),
  cachedReadTokens: Schema.NullOr(Schema.Int),
  cachedWriteTokens: Schema.NullOr(Schema.Int),
  totalTokens: Schema.NullOr(Schema.Int),
  durationMs: Schema.NullOr(Schema.Int),
  finishedAt: Schema.NullOr(Schema.String)
})

export type KitWriting = typeof KitWriting.Type

export const ApplicationDetail = Schema.Struct({
  application: ApplicationRecord,
  kit: Schema.optional(Schema.NullOr(KitRecord)),
  writing: Schema.optional(Schema.NullOr(KitWriting)),
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

/* -------------------------------------------------------------------------- */
/* The browser extension on hh's own response form                            */
/* -------------------------------------------------------------------------- */

/**
 * One draft the extension can paste into hh's response form when the operator
 * opens it by hand: the newest kit of an application to the vacancy. The
 * extension matches it to the resume the form has selected.
 */
export const BrowserDraft = Schema.Struct({
  applicationId: ApplicationId,
  hhAccountId: HhAccountId,
  accountName: Schema.NullOr(Schema.String),
  resumeId: Schema.NullOr(ResumeId),
  resumeTitle: Schema.NullOr(Schema.String),
  /** hh's numeric id of the resume (`resume.external_id`): what the extension matches the form by. */
  resumeExternalId: Schema.NullOr(Schema.String),
  state: ApplicationState,
  /** The form the kit was written for; null without a kit. */
  formHash: Schema.NullOr(Schema.String),
  letter: Schema.NullOr(Schema.String),
  answers: Schema.Array(FormAnswer),
  /** The unsent letter for a response hh already holds (letter draft). */
  pendingLetter: Schema.NullOr(Schema.String),
  updatedAt: Schema.String
})

export type BrowserDraft = typeof BrowserDraft.Type

export const BrowserDrafts = Schema.Struct({
  /** null when the vacancy is not in the corpus. */
  vacancyId: Schema.NullOr(VacancyId),
  /** The account of the page's hh user, when it is one of otbor's; drafts are then its only. */
  hhAccountId: Schema.NullOr(HhAccountId),
  drafts: Schema.Array(BrowserDraft)
})

export type BrowserDrafts = typeof BrowserDrafts.Type

/**
 * `recorded`: the application is stored as submitted (or its letter stored).
 * `already`: it was submitted before; nothing changed. `in_flight`: otbor's own
 * submit is queued or running, so the cloud leaves it to the reconcile.
 * `unconfirmed`: the evidence shows no response. `unknown_vacancy`: the
 * vacancy is not in the corpus. `no_account`: the hh account is ambiguous.
 */
export const BrowserSubmitStatus = Schema.Literals([
  "recorded",
  "already",
  "in_flight",
  "unconfirmed",
  "unknown_vacancy",
  "no_account"
])

export type BrowserSubmitStatus = typeof BrowserSubmitStatus.Type

export const BrowserSubmitResult = Schema.Struct({
  status: BrowserSubmitStatus,
  application: Schema.NullOr(ApplicationRecord),
  message: Schema.NullOr(Schema.String)
})

export type BrowserSubmitResult = typeof BrowserSubmitResult.Type
