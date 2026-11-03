import { Schema } from "effect"
import { FormAnswer, StoredForm } from "./form.ts"
import {
  ApplicationOrigin,
  ApplicationState,
  AttemptStage,
  BlacklistScope,
  BlacklistSource,
  BlacklistTarget,
  ContactKind,
  ContactSource,
  ConversationChannel,
  CrawlRunStatus,
  DecisionReasonCode,
  DecisionVerdict,
  GateVerdict,
  HarnessExitTag,
  JobKind,
  JobStage,
  JobStatus,
  KeywordMatchLocation,
  LetterPolicy,
  MessageDirection,
  MessageKind,
  PresetKind,
  ScheduleKind,
  SourceSyncKind,
  Seniority,
  StreamMode,
  TestsPolicy,
  TitleVerdictSource,
  WorkFormat
} from "./enums.ts"
import {
  ApplicationId,
  AttemptId,
  BlacklistId,
  ContactId,
  ConversationId,
  DecisionId,
  EmployerId,
  HarnessId,
  HarnessJobId,
  HhAccountId,
  KeywordAliasId,
  KeywordId,
  KitId,
  LeaseId,
  MailAccountId,
  PresetId,
  ResumeId,
  ScheduleId,
  ScheduleRunId,
  SearchQueryId,
  SearchRunId,
  TelegramAccountId,
  UserId,
  VacancyId
} from "./ids.ts"

/* -------------------------------------------------------------------------- */
/* Corpus                                                                     */
/* -------------------------------------------------------------------------- */

export const EmployerDraft = Schema.Struct({
  externalId: Schema.String,
  name: Schema.String,
  rating: Schema.optional(Schema.NullOr(Schema.Number)),
  reviewsCount: Schema.optional(Schema.NullOr(Schema.Int)),
  recommendationsPercent: Schema.optional(Schema.NullOr(Schema.Int)),
  siteUrl: Schema.optional(Schema.NullOr(Schema.String)),
  logoUrl: Schema.optional(Schema.NullOr(Schema.String)),
  industries: Schema.optional(Schema.Array(Schema.String))
})

export type EmployerDraft = typeof EmployerDraft.Type

export const SalaryDraft = Schema.Struct({
  from: Schema.optional(Schema.NullOr(Schema.Int)),
  to: Schema.optional(Schema.NullOr(Schema.Int)),
  currency: Schema.optional(Schema.NullOr(Schema.String)),
  gross: Schema.optional(Schema.NullOr(Schema.Boolean)),
  negotiable: Schema.optional(Schema.Boolean)
})

export type SalaryDraft = typeof SalaryDraft.Type

/**
 * A normalized vacancy coming from an adapter (HTTP page, HTML file, browser
 * extension). Everything below the boundary is typed; `raw` keeps the original
 * payload for re-parsing when the adapter improves.
 */
export const VacancyDraft = Schema.Struct({
  source: Schema.optional(Schema.String),
  externalId: Schema.String,
  canonicalUrl: Schema.String,
  url: Schema.optional(Schema.String),
  title: Schema.String,
  employer: Schema.optional(Schema.NullOr(EmployerDraft)),
  areaId: Schema.optional(Schema.NullOr(Schema.Int)),
  areaName: Schema.optional(Schema.NullOr(Schema.String)),
  salary: Schema.optional(Schema.NullOr(SalaryDraft)),
  experienceCode: Schema.optional(Schema.NullOr(Schema.String)),
  employmentForm: Schema.optional(Schema.NullOr(Schema.String)),
  workFormats: Schema.optional(Schema.Array(Schema.String)),
  seniority: Schema.optional(Seniority),
  publishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  archived: Schema.optional(Schema.Boolean),
  descriptionHtml: Schema.optional(Schema.NullOr(Schema.String)),
  descriptionText: Schema.optional(Schema.NullOr(Schema.String)),
  skills: Schema.optional(Schema.Array(Schema.String)),
  responsesTotal: Schema.optional(Schema.NullOr(Schema.Int)),
  responsesVacancy: Schema.optional(Schema.NullOr(Schema.Int)),
  raw: Schema.optional(Schema.Unknown)
})

export type VacancyDraft = typeof VacancyDraft.Type

export const VacancySummary = Schema.Struct({
  id: VacancyId,
  source: Schema.String,
  externalId: Schema.String,
  canonicalUrl: Schema.String,
  title: Schema.String,
  employerId: Schema.optional(Schema.NullOr(EmployerId)),
  employerName: Schema.optional(Schema.NullOr(Schema.String)),
  employerRating: Schema.optional(Schema.NullOr(Schema.Number)),
  areaName: Schema.optional(Schema.NullOr(Schema.String)),
  salaryFrom: Schema.optional(Schema.NullOr(Schema.Int)),
  salaryTo: Schema.optional(Schema.NullOr(Schema.Int)),
  salaryCurrency: Schema.optional(Schema.NullOr(Schema.String)),
  seniority: Seniority,
  experienceCode: Schema.optional(Schema.NullOr(Schema.String)),
  employmentForm: Schema.optional(Schema.NullOr(Schema.String)),
  workFormats: Schema.Array(Schema.String),
  publishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  archived: Schema.Boolean,
  createdAt: Schema.String,
  lastSeenAt: Schema.String,
  /** A label, not a ban: the row is still in the corpus and can be shown. */
  blacklisted: Schema.Boolean,
  /** Which layers matched: app, the selected hh account, or hh native hiding. */
  blacklistLayers: Schema.Array(BlacklistScope)
})

export type VacancySummary = typeof VacancySummary.Type

export const EmployerSummary = Schema.Struct({
  id: EmployerId,
  source: Schema.String,
  externalId: Schema.String,
  name: Schema.String,
  rating: Schema.optional(Schema.NullOr(Schema.Number)),
  reviewsCount: Schema.optional(Schema.NullOr(Schema.Int)),
  recommendationsPercent: Schema.optional(Schema.NullOr(Schema.Int)),
  siteUrl: Schema.optional(Schema.NullOr(Schema.String)),
  logoUrl: Schema.optional(Schema.NullOr(Schema.String)),
  industries: Schema.Array(Schema.String),
  vacancyCount: Schema.Int,
  blacklisted: Schema.Boolean,
  blacklistLayers: Schema.Array(BlacklistScope)
})

export type EmployerSummary = typeof EmployerSummary.Type

export const EmployerDetail = Schema.Struct({
  employer: EmployerSummary,
  vacancies: Schema.Array(VacancySummary)
})

export type EmployerDetail = typeof EmployerDetail.Type

/**
 * One blacklist row. `scope = app` has no account; account and native rows do.
 * The record is a visibility filter and a label — it never removes a vacancy
 * or an employer from the corpus.
 */
export const BlacklistRecord = Schema.Struct({
  id: BlacklistId,
  scope: BlacklistScope,
  hhAccountId: Schema.optional(Schema.NullOr(HhAccountId)),
  targetType: BlacklistTarget,
  externalId: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  source: BlacklistSource,
  reason: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  lastSeenAt: Schema.optional(Schema.NullOr(Schema.String))
})

export type BlacklistRecord = typeof BlacklistRecord.Type

export const KeywordMatchRecord = Schema.Struct({
  keywordId: KeywordId,
  term: Schema.String,
  aliasId: Schema.optional(Schema.NullOr(KeywordAliasId)),
  matchedForm: Schema.String,
  typo: Schema.Boolean,
  inTitle: Schema.Boolean,
  titleCount: Schema.Int,
  inBody: Schema.Boolean,
  bodyCount: Schema.Int,
  inSkills: Schema.Boolean
})

export type KeywordMatchRecord = typeof KeywordMatchRecord.Type

export const VacancyDetail = Schema.Struct({
  vacancy: VacancySummary,
  descriptionText: Schema.String,
  descriptionHtml: Schema.optional(Schema.NullOr(Schema.String)),
  skills: Schema.Array(Schema.String),
  keywords: Schema.Array(KeywordMatchRecord),
  titleVerdict: Schema.optional(Schema.NullOr(GateVerdict))
})

export type VacancyDetail = typeof VacancyDetail.Type

/**
 * A stored vacancy that still needs its full page. The corpus keeps the search
 * card as a stub first; hydration replaces it with the vacancy page.
 */
export const HydrationTarget = Schema.Struct({
  id: VacancyId,
  source: Schema.String,
  externalId: Schema.String,
  canonicalUrl: Schema.String,
  title: Schema.String,
  descriptionLength: Schema.Int,
  employerName: Schema.optional(Schema.NullOr(Schema.String)),
  areaName: Schema.optional(Schema.NullOr(Schema.String)),
  publishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  lastSeenAt: Schema.optional(Schema.NullOr(Schema.String))
})

export type HydrationTarget = typeof HydrationTarget.Type

export const EmployerHydrationMissing = Schema.Literals(["rating", "siteUrl", "logoUrl", "industries"])
export type EmployerHydrationMissing = typeof EmployerHydrationMissing.Type

/**
 * A profile worth refreshing: only employers backing vacancies are offered,
 * oldest profile first. `missing` makes the gaps visible without opening hh.
 */
export const EmployerHydrationTarget = Schema.Struct({
  id: EmployerId,
  source: Schema.String,
  externalId: Schema.String,
  name: Schema.String,
  rating: Schema.optional(Schema.NullOr(Schema.Number)),
  reviewsCount: Schema.optional(Schema.NullOr(Schema.Int)),
  recommendationsPercent: Schema.optional(Schema.NullOr(Schema.Int)),
  siteUrl: Schema.optional(Schema.NullOr(Schema.String)),
  logoUrl: Schema.optional(Schema.NullOr(Schema.String)),
  industries: Schema.Array(Schema.String),
  vacancyCount: Schema.Int,
  updatedAt: Schema.String,
  missing: Schema.Array(EmployerHydrationMissing)
})
export type EmployerHydrationTarget = typeof EmployerHydrationTarget.Type

/** Counts shown on the hydration page; employers are always the hh corpus. */
export const HydrationStats = Schema.Struct({
  vacancyTotal: Schema.Int,
  vacancyFull: Schema.Int,
  vacancyStub: Schema.Int,
  employerTotal: Schema.Int,
  employersLinked: Schema.Int,
  employersWithoutRating: Schema.Int,
  employersWithoutSite: Schema.Int,
  employersWithoutLogo: Schema.Int,
  employersWithoutIndustries: Schema.Int,
  employersStale30Days: Schema.Int
})
export type HydrationStats = typeof HydrationStats.Type

/* -------------------------------------------------------------------------- */
/* Search runs                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One persisted crawl. `nextPage` is both the resume cursor and, right after
 * start, the page the run began on: `search_run` has no separate start column
 * and a resumed run is exactly "start here next time".
 */
export const CrawlRun = Schema.Struct({
  runId: SearchRunId,
  queryId: SearchQueryId,
  normalizedUrl: Schema.String,
  status: CrawlRunStatus,
  nextPage: Schema.Int,
  /** Zero-based page currently being crawled or last completed; null for legacy rows. */
  currentPage: Schema.NullOr(Schema.Int),
  /** Total pages reported by the search engine; null until known. */
  pagesTotal: Schema.NullOr(Schema.Int),
  pagesDone: Schema.Int,
  found: Schema.Int,
  inserted: Schema.Int,
  updated: Schema.Int,
  skipped: Schema.Int,
  error: Schema.optional(Schema.NullOr(Schema.String)),
  startedAt: Schema.String,
  finishedAt: Schema.optional(Schema.NullOr(Schema.String))
})

export type CrawlRun = typeof CrawlRun.Type

/* -------------------------------------------------------------------------- */
/* Crawl schedules                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A recurring crawl of one saved search. `targetId` is the hh search URL, not
 * a `search_query` id, because a schedule outlives any single run and the URL
 * is what the crawler actually needs.
 *
 * `lastError` is the last failure text; a successful run clears it. Null
 * timestamps mean "never happened" rather than "unknown".
 */
export const CrawlSchedule = Schema.Struct({
  id: ScheduleId,
  kind: ScheduleKind,
  targetId: Schema.String,
  intervalMinutes: Schema.Int,
  /** Per-kind knobs (`limit`, `delayMs`, `dialogs`, `messages`, …). */
  options: Schema.Record(Schema.String, Schema.Unknown),
  enabled: Schema.Boolean,
  nextRunAt: Schema.NullOr(Schema.String),
  lastRunAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type CrawlSchedule = typeof CrawlSchedule.Type

/* -------------------------------------------------------------------------- */
/* Schedule runs                                                              */
/* -------------------------------------------------------------------------- */

export const ScheduleRun = Schema.Struct({
  id: ScheduleRunId,
  scheduleId: ScheduleId,
  kind: SourceSyncKind,
  status: Schema.Literals(["running", "done", "error"]),
  detail: Schema.optional(Schema.NullOr(Schema.Unknown)),
  error: Schema.optional(Schema.NullOr(Schema.String)),
  startedAt: Schema.String,
  finishedAt: Schema.optional(Schema.NullOr(Schema.String))
})

export type ScheduleRun = typeof ScheduleRun.Type

/* -------------------------------------------------------------------------- */
/* Sources: contacts and conversations                                        */
/* -------------------------------------------------------------------------- */

/**
 * One way to reach a person. The same `kind`+`value` is unique per user, so a
 * second sighting updates evidence and confidence instead of adding a row.
 */
export const ContactSummary = Schema.Struct({
  id: ContactId,
  personName: Schema.NullOr(Schema.String),
  personRole: Schema.NullOr(Schema.String),
  kind: ContactKind,
  value: Schema.String,
  url: Schema.NullOr(Schema.String),
  source: ContactSource,
  confidence: Schema.NullOr(Schema.Number),
  isBot: Schema.Boolean,
  vacancyId: Schema.NullOr(VacancyId),
  lastSeenAt: Schema.String
})

export type ContactSummary = typeof ContactSummary.Type

export const ContactRecord = Schema.Struct({
  ...ContactSummary.fields,
  evidence: Schema.NullOr(Schema.String),
  employerId: Schema.NullOr(EmployerId),
  firstSeenAt: Schema.String
})

export type ContactRecord = typeof ContactRecord.Type

export const ConversationSummary = Schema.Struct({
  id: ConversationId,
  channel: ConversationChannel,
  /** Mail account / Telegram account id, as text so a channel can be rerouted. */
  accountId: Schema.String,
  externalId: Schema.String,
  title: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  personName: Schema.NullOr(Schema.String),
  personRole: Schema.NullOr(Schema.String),
  lastMessageAt: Schema.NullOr(Schema.String),
  unreadCount: Schema.Int,
  archived: Schema.Boolean,
  /** Text of the newest stored message, for list previews. */
  lastMessage: Schema.NullOr(Schema.String),
  /** The vacancy the thread is about, when one was linked. */
  vacancyId: Schema.NullOr(VacancyId)
})

export type ConversationSummary = typeof ConversationSummary.Type

export const ConversationMessageRecord = Schema.Struct({
  id: Schema.String,
  externalId: Schema.String,
  direction: MessageDirection,
  sentAt: Schema.String,
  kind: MessageKind,
  text: Schema.NullOr(Schema.String),
  readAt: Schema.NullOr(Schema.String)
})

export type ConversationMessageRecord = typeof ConversationMessageRecord.Type

export const ConversationDetail = Schema.Struct({
  conversation: ConversationSummary,
  messages: Schema.Array(ConversationMessageRecord)
})

export type ConversationDetail = typeof ConversationDetail.Type

/* -------------------------------------------------------------------------- */
/* Sources: accounts                                                          */
/* -------------------------------------------------------------------------- */

export const MailAccountRecord = Schema.Struct({
  id: MailAccountId,
  label: Schema.String,
  address: Schema.String,
  host: Schema.String,
  port: Schema.Int,
  secure: Schema.Boolean,
  username: Schema.String,
  includeSent: Schema.Boolean,
  backfillDays: Schema.Int,
  status: Schema.String,
  enabled: Schema.Boolean,
  lastSyncAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type MailAccountRecord = typeof MailAccountRecord.Type

export const TelegramAccountRecord = Schema.Struct({
  id: TelegramAccountId,
  label: Schema.String,
  tgUserId: Schema.NullOr(Schema.String),
  username: Schema.NullOr(Schema.String),
  phoneMasked: Schema.NullOr(Schema.String),
  status: Schema.String,
  enabled: Schema.Boolean,
  lastSyncAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type TelegramAccountRecord = typeof TelegramAccountRecord.Type

export const HhSessionState = Schema.Literals(["ok", "expired", "blocked"])
export type HhSessionState = typeof HhSessionState.Type

/** Health of one account's hh.ru login. Cookies never leave the operator's disk. */
export const HhSessionRecord = Schema.Struct({
  state: HhSessionState,
  lastOkAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  updatedAt: Schema.String
})
export type HhSessionRecord = typeof HhSessionRecord.Type

export const HhAccountRecord = Schema.Struct({
  id: HhAccountId,
  label: Schema.String,
  isDefault: Schema.Boolean,
  sessionProfile: Schema.NullOr(Schema.String),
  firstName: Schema.optional(Schema.NullOr(Schema.String)),
  lastName: Schema.optional(Schema.NullOr(Schema.String)),
  areaName: Schema.optional(Schema.NullOr(Schema.String)),
  session: Schema.optional(Schema.NullOr(HhSessionRecord)),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type HhAccountRecord = typeof HhAccountRecord.Type

/** Outcome of one bounded source sync; counters, never row dumps. */
export const SyncResult = Schema.Struct({
  processed: Schema.Int,
  inserted: Schema.Int,
  updated: Schema.Int,
  skipped: Schema.Int,
  contacts: Schema.Int,
  linked: Schema.Int,
  errors: Schema.Array(Schema.String)
})

export type SyncResult = typeof SyncResult.Type

/** Status of a detached QR login, polled by the CLI. */
export const TelegramLoginStatusValue = Schema.Literals([
  "idle",
  "pending",
  "authorized",
  "error"
])

export type TelegramLoginStatusValue = typeof TelegramLoginStatusValue.Type

/* -------------------------------------------------------------------------- */
/* Gate, lexicon, decisions                                                   */
/* -------------------------------------------------------------------------- */

export const TitleGateResult = Schema.Struct({
  title: Schema.String,
  titleNormalized: Schema.String,
  roleFamily: Schema.NullOr(Schema.String),
  verdict: GateVerdict,
  matched: Schema.Array(Schema.String),
  rejectedBy: Schema.optional(Schema.NullOr(Schema.String)),
  strong: Schema.Array(Schema.String),
  weak: Schema.Array(Schema.String),
  rulesVersion: Schema.Int
})

export type TitleGateResult = typeof TitleGateResult.Type

export const TitleVerdictRecord = Schema.Struct({
  normalizedTitle: Schema.String,
  roleFamily: Schema.NullOr(Schema.String),
  verdict: GateVerdict,
  source: TitleVerdictSource,
  matched: Schema.Array(Schema.String),
  rejectedBy: Schema.optional(Schema.NullOr(Schema.String)),
  rulesVersion: Schema.Int,
  createdAt: Schema.String
})

export type TitleVerdictRecord = typeof TitleVerdictRecord.Type

export const KeywordAliasRecord = Schema.Struct({
  id: KeywordAliasId,
  alias: Schema.String,
  normalizedAlias: Schema.String,
  typo: Schema.Boolean,
  matchType: Schema.String
})

export type KeywordAliasRecord = typeof KeywordAliasRecord.Type

export const KeywordAliasStat = Schema.Struct({
  alias: Schema.String,
  normalizedAlias: Schema.String,
  typo: Schema.Boolean,
  vacancies: Schema.Int,
  mentions: Schema.Int,
  share: Schema.Int
})

export type KeywordAliasStat = typeof KeywordAliasStat.Type

export const LexiconKeyword = Schema.Struct({
  id: KeywordId,
  term: Schema.String,
  normalizedTerm: Schema.String,
  enabled: Schema.Boolean,
  /** Vacancies that mention this keyword, after the caller's preset filter. */
  vacancyCount: Schema.Int,
  aliases: Schema.Array(KeywordAliasRecord),
  aliasStats: Schema.Array(KeywordAliasStat)
})

export type LexiconKeyword = typeof LexiconKeyword.Type

export const DecisionReason = Schema.Struct({
  code: DecisionReasonCode,
  detail: Schema.optional(Schema.String),
  weight: Schema.optional(Schema.Number)
})

export type DecisionReason = typeof DecisionReason.Type

export const DecisionRecord = Schema.Struct({
  id: DecisionId,
  userId: UserId,
  hhAccountId: Schema.optional(Schema.NullOr(HhAccountId)),
  resumeId: Schema.optional(Schema.NullOr(ResumeId)),
  vacancyId: VacancyId,
  vacancyTitle: Schema.optional(Schema.String),
  roleFamily: Schema.NullOr(Schema.String),
  verdict: DecisionVerdict,
  gate: GateVerdict,
  fit: Schema.Int,
  priority: Schema.Number,
  reasons: Schema.Array(DecisionReason),
  policyVersion: Schema.Int,
  createdAt: Schema.String
})

export type DecisionRecord = typeof DecisionRecord.Type

/**
 * Outcome of one batch evaluation. `byReason` counts the primary (first)
 * reason code of every decision made in the batch.
 */
export const EvaluateBatchResult = Schema.Struct({
  /** Vacancies that went through the decision cascade in this call. */
  evaluated: Schema.Int,
  apply: Schema.Int,
  draft: Schema.Int,
  skip: Schema.Int,
  /** Vacancies that still lack a current decision after this call. */
  remaining: Schema.Int,
  byReason: Schema.Record(Schema.String, Schema.Int)
})

export type EvaluateBatchResult = typeof EvaluateBatchResult.Type

/* -------------------------------------------------------------------------- */
/* Applications                                                               */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Harness queue                                                              */
/* -------------------------------------------------------------------------- */

export const HarnessJob = Schema.Struct({
  id: HarnessJobId,
  kind: JobKind,
  stage: JobStage,
  status: JobStatus,
  priority: Schema.Int,
  payload: Schema.Unknown,
  /** Inference output, filled by the harness on completion. */
  result: Schema.optional(Schema.NullOr(Schema.Unknown)),
  attempts: Schema.Int,
  maxAttempts: Schema.Int,
  leaseId: Schema.NullOr(LeaseId),
  leaseEpoch: Schema.Int,
  leaseUntil: Schema.optional(Schema.NullOr(Schema.String)),
  runAt: Schema.String,
  createdAt: Schema.String
})

export type HarnessJob = typeof HarnessJob.Type

/* -------------------------------------------------------------------------- */
/* Inference                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * An ACP prompt carried inside the job envelope. The cloud never sends free
 * text to a model directly: it enqueues this payload, and an inference
 * harness runs it through `opencode acp` or another ACP agent.
 */
export const InferencePayload = Schema.Struct({
  prompt: Schema.String,
  system: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  /** Optional JSON schema the agent should satisfy with its answer. */
  jsonSchema: Schema.optional(Schema.Unknown)
})

export type InferencePayload = typeof InferencePayload.Type

export const InferenceResult = Schema.Struct({
  text: Schema.String,
  model: Schema.optional(Schema.NullOr(Schema.String)),
  usage: Schema.optional(Schema.Unknown),
  providerResponse: Schema.optional(Schema.Unknown),
  durationMs: Schema.optional(Schema.Int)
})

export type InferenceResult = typeof InferenceResult.Type

export const HarnessRegistration = Schema.Struct({
  id: HarnessId,
  name: Schema.String,
  kinds: Schema.Array(JobKind),
  accounts: Schema.Array(HhAccountId),
  /**
   * The device token in plaintext. It is present only in the `HarnessRegister`
   * response and is never stored or returned again.
   */
  token: Schema.NullOr(Schema.String),
  lastSeenAt: Schema.String
})

export type HarnessRegistration = typeof HarnessRegistration.Type

export const QueueStats = Schema.Struct({
  pending: Schema.Int,
  leased: Schema.Int,
  running: Schema.Int,
  done: Schema.Int,
  failed: Schema.Int,
  dead: Schema.Int,
  needsHuman: Schema.Int,
  needsReconcile: Schema.Int,
  oldestPendingAgeSeconds: Schema.Int
})

export type QueueStats = typeof QueueStats.Type

export const HeartbeatResult = Schema.Struct({
  ok: Schema.Boolean,
  reason: Schema.optional(Schema.NullOr(Schema.String))
})

export type HeartbeatResult = typeof HeartbeatResult.Type

/* -------------------------------------------------------------------------- */
/* Presets and streams                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The concrete filter a preset carries. Every field is optional: an absent
 * field does not constrain the result.
 *
 * `text` matches the vacancy title case-insensitively, `gate` keeps only
 * titles with that cached verdict, and `includeArchived` widens the search to
 * archived vacancies. `keywordIds` only narrows which keywords are returned;
 * it never changes which vacancies are counted.
 */
/**
 * A preset is a conjunction of rules plus a few legacy shorthands. The legacy
 * `text`/`gate` fields predate the rule builder and are normalized into rules
 * by the UI; they stay in the schema so old rows keep working.
 */
export const PresetField = Schema.Literals([
  "title",
  "description",
  "skills",
  "keywords",
  "employer",
  "area",
  "salary_from",
  "salary_to",
  "salary_currency",
  "seniority",
  "work_format",
  "experience",
  "employment_form",
  "published_days",
  "archived",
  "gate",
  "role_family",
  "source",
  "responses_total",
  "description_length",
  "skills_count"
])

export type PresetField = typeof PresetField.Type

export const PresetOperator = Schema.Literals([
  "contains",
  "not_contains",
  "eq",
  "neq",
  "in",
  "not_in",
  "gte",
  "lte",
  "is_true",
  "is_false"
])

export type PresetOperator = typeof PresetOperator.Type

export const PresetRuleValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Array(Schema.String)
])

export type PresetRuleValue = typeof PresetRuleValue.Type

export const PresetRule = Schema.Struct({
  field: PresetField,
  op: PresetOperator,
  value: Schema.optional(PresetRuleValue)
})

export type PresetRule = typeof PresetRule.Type

export const PresetFilter = Schema.Struct({
  /** Additional AND rules over vacancy fields. */
  rules: Schema.optional(Schema.Array(PresetRule)),
  text: Schema.optional(Schema.String),
  gate: Schema.optional(GateVerdict),
  keywordIds: Schema.optional(Schema.Array(KeywordId)),
  /** Where a keyword must appear: title, body, HH skills, or text+skills. */
  location: Schema.optional(KeywordMatchLocation),
  includeArchived: Schema.optional(Schema.Boolean),
  /**
   * By default a preset excludes app-level blacklisted companies; `true`
   * explicitly includes them so the preset can drive auto-applies.
   */
  includeBlacklisted: Schema.optional(Schema.Boolean)
})

export type PresetFilter = typeof PresetFilter.Type

export const emptyPresetFilter: PresetFilter = {}

/**
 * Parses a stored or submitted filter and drops values that mean "no
 * constraint": blank text, an empty keyword list and `includeArchived: false`.
 * Unknown properties (the legacy `{"all":[]}` default) are ignored.
 */
export const parsePresetFilter = (input: unknown): PresetFilter => {
  const decoded = Schema.decodeUnknownSync(PresetFilter)(input ?? {})
  const text = decoded.text?.trim() ?? ""
  const keywordIds = decoded.keywordIds === undefined
    ? []
    : [...new Set(decoded.keywordIds)]
  const rules = (decoded.rules ?? []).filter((rule) => {
    if (rule.op === "is_true" || rule.op === "is_false") return true
    if (rule.value === undefined || rule.value === "") return false
    return !Array.isArray(rule.value) || rule.value.length > 0
  })

  return {
    ...(rules.length === 0 ? {} : { rules }),
    ...(text === "" ? {} : { text }),
    ...(decoded.gate === undefined ? {} : { gate: decoded.gate }),
    ...(keywordIds.length === 0 ? {} : { keywordIds }),
    ...(decoded.location === undefined || decoded.location === "any"
      ? {}
      : { location: decoded.location }),
    ...(decoded.includeArchived === true ? { includeArchived: true } : {}),
    ...(decoded.includeBlacklisted === true ? { includeBlacklisted: true } : {})
  }
}

export const PresetRecord = Schema.Struct({
  id: PresetId,
  userId: Schema.optional(Schema.NullOr(UserId)),
  kind: PresetKind,
  title: Schema.String,
  filter: PresetFilter,
  system: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type PresetRecord = typeof PresetRecord.Type

export const PresetFacet = Schema.Struct({
  term: Schema.String,
  count: Schema.Int
})

export type PresetFacet = typeof PresetFacet.Type

export const PresetCompanyFacet = Schema.Struct({
  id: EmployerId,
  name: Schema.String,
  count: Schema.Int
})

export type PresetCompanyFacet = typeof PresetCompanyFacet.Type

/** A live preview of what the current preset rules select. */
export const PresetPreview = Schema.Struct({
  count: Schema.Int,
  keywords: Schema.Array(PresetFacet),
  skills: Schema.Array(PresetFacet),
  companies: Schema.Array(PresetCompanyFacet),
  vacancies: Schema.Array(VacancySummary)
})

export type PresetPreview = typeof PresetPreview.Type

export const StreamRecord = Schema.Struct({
  id: Schema.String,
  userId: UserId,
  hhAccountId: HhAccountId,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  presetId: Schema.optional(Schema.NullOr(PresetId)),
  mode: StreamMode,
  letterPolicy: LetterPolicy,
  testsPolicy: TestsPolicy,
  enabled: Schema.Boolean
})

export type StreamRecord = typeof StreamRecord.Type

/* -------------------------------------------------------------------------- */
/* System                                                                     */
/* -------------------------------------------------------------------------- */

export const ResumeExperienceEnrichment = Schema.Struct({
  key: Schema.String,
  employmentType: Schema.optional(Schema.NullOr(Schema.String)),
  comment: Schema.optional(Schema.NullOr(Schema.String)),
  leaveReason: Schema.optional(Schema.NullOr(Schema.String))
})

export type ResumeExperienceEnrichment = typeof ResumeExperienceEnrichment.Type

export const ResumeEnrichment = Schema.Struct({
  resumeId: ResumeId,
  comment: Schema.String,
  salaryMin: Schema.optional(Schema.NullOr(Schema.Int)),
  salaryExpectation: Schema.optional(Schema.NullOr(Schema.Int)),
  currency: Schema.optional(Schema.NullOr(Schema.String)),
  experience: Schema.Array(ResumeExperienceEnrichment),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String))
})

export type ResumeEnrichment = typeof ResumeEnrichment.Type

export const ResumeRecord = Schema.Struct({
  id: ResumeId,
  hhAccountId: HhAccountId,
  source: Schema.String,
  externalId: Schema.String,
  title: Schema.String,
  text: Schema.String,
  about: Schema.String,
  skills: Schema.Array(Schema.String),
  experience: Schema.Array(Schema.Unknown),
  education: Schema.Unknown,
  workFormats: Schema.Array(Schema.String),
  salaryAmount: Schema.optional(Schema.NullOr(Schema.Int)),
  salaryCurrency: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  isActive: Schema.Boolean,
  lastSeenAt: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type ResumeRecord = typeof ResumeRecord.Type

export const ResumeDraft = Schema.Struct({
  hhAccountId: HhAccountId,
  source: Schema.optional(Schema.String),
  externalId: Schema.String,
  title: Schema.String,
  text: Schema.String,
  about: Schema.optional(Schema.String),
  skills: Schema.optional(Schema.Array(Schema.String)),
  experience: Schema.optional(Schema.Unknown),
  education: Schema.optional(Schema.Unknown),
  workFormats: Schema.optional(Schema.Array(Schema.String)),
  salaryAmount: Schema.optional(Schema.NullOr(Schema.Int)),
  salaryCurrency: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  isActive: Schema.optional(Schema.Boolean),
  lastSeenAt: Schema.optional(Schema.String)
})

export type ResumeDraft = typeof ResumeDraft.Type

export const HealthAccount = Schema.Struct({
  id: HhAccountId,
  label: Schema.String,
  sessionProfile: Schema.NullOr(Schema.String),
  session: Schema.NullOr(HhSessionRecord)
})
export type HealthAccount = typeof HealthAccount.Type

export const Health = Schema.Struct({
  status: Schema.Literals(["ok", "degraded"]),
  version: Schema.String,
  database: Schema.Boolean,
  now: Schema.String,
  accounts: Schema.optional(Schema.Array(HealthAccount))
})

export type Health = typeof Health.Type
