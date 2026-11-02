import { Schema } from "effect"
import {
  ApplicationState,
  AttemptStage,
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
  PresetKind,
  ScheduleKind,
  Seniority,
  StreamMode,
  TestsPolicy,
  TitleVerdictSource,
  WorkFormat
} from "./enums.ts"
import {
  ApplicationId,
  AttemptId,
  DecisionId,
  EmployerId,
  HarnessId,
  HarnessJobId,
  HhAccountId,
  KeywordAliasId,
  KeywordId,
  KitId,
  LeaseId,
  PresetId,
  ResumeId,
  ScheduleId,
  SearchQueryId,
  SearchRunId,
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
  publishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  archived: Schema.Boolean,
  createdAt: Schema.String,
  lastSeenAt: Schema.String
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
  vacancyCount: Schema.Int
})

export type EmployerSummary = typeof EmployerSummary.Type

export const EmployerDetail = Schema.Struct({
  employer: EmployerSummary,
  vacancies: Schema.Array(VacancySummary)
})

export type EmployerDetail = typeof EmployerDetail.Type

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
  descriptionLength: Schema.Int
})

export type HydrationTarget = typeof HydrationTarget.Type

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
  pagesDone: Schema.Int,
  found: Schema.Int,
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
  enabled: Schema.Boolean,
  nextRunAt: Schema.NullOr(Schema.String),
  lastRunAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type CrawlSchedule = typeof CrawlSchedule.Type

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

export const LexiconKeyword = Schema.Struct({
  id: KeywordId,
  term: Schema.String,
  normalizedTerm: Schema.String,
  enabled: Schema.Boolean,
  /** Vacancies that mention this keyword, after the caller's preset filter. */
  vacancyCount: Schema.Int,
  aliases: Schema.Array(KeywordAliasRecord)
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
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export type ApplicationRecord = typeof ApplicationRecord.Type

export const KitRecord = Schema.Struct({
  id: KitId,
  applicationId: ApplicationId,
  formHash: Schema.String,
  letter: Schema.optional(Schema.NullOr(Schema.String)),
  answers: Schema.Array(Answer),
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
export const PresetFilter = Schema.Struct({
  text: Schema.optional(Schema.String),
  gate: Schema.optional(GateVerdict),
  keywordIds: Schema.optional(Schema.Array(KeywordId)),
  /** Where a keyword must appear: title, body, HH skills, or text+skills. */
  location: Schema.optional(KeywordMatchLocation),
  includeArchived: Schema.optional(Schema.Boolean)
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

  return {
    ...(text === "" ? {} : { text }),
    ...(decoded.gate === undefined ? {} : { gate: decoded.gate }),
    ...(keywordIds.length === 0 ? {} : { keywordIds }),
    ...(decoded.location === undefined || decoded.location === "any"
      ? {}
      : { location: decoded.location }),
    ...(decoded.includeArchived === true ? { includeArchived: true } : {})
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

export const Health = Schema.Struct({
  status: Schema.Literals(["ok", "degraded"]),
  version: Schema.String,
  database: Schema.Boolean,
  now: Schema.String
})

export type Health = typeof Health.Type
