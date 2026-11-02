import { Schema } from "effect"
import { Rpc, type RpcClient, type RpcClientError, RpcGroup } from "effect/rpc"
import { CrawlFinishStatus, JobKind } from "./enums.ts"
import {
  ApplicationId,
  HhAccountId,
  HarnessId,
  HarnessJobId,
  KeywordId,
  LeaseId,
  SearchRunId,
  VacancyId
} from "./ids.ts"
import { ApiError } from "./errors.ts"
import {
  ApplicationDetail,
  ApplicationRecord,
  CrawlRun,
  DecisionRecord,
  HarnessExit,
  HarnessJob,
  HarnessRegistration,
  Health,
  HeartbeatResult,
  HydrationTarget,
  KitRecord,
  LexiconKeyword,
  PresetRecord,
  QueueStats,
  TitleGateResult,
  TitleVerdictRecord,
  VacancyDetail,
  VacancyDraft,
  VacancySummary
} from "./models.ts"

/* -------------------------------------------------------------------------- */
/* System                                                                     */
/* -------------------------------------------------------------------------- */

export const SystemHealth = Rpc.make("SystemHealth", {
  success: Health,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Corpus                                                                     */
/* -------------------------------------------------------------------------- */

export const IngestResult = Schema.Struct({
  inserted: Schema.Int,
  updated: Schema.Int,
  skipped: Schema.Int,
  items: Schema.Array(VacancySummary)
})

export type IngestResult = typeof IngestResult.Type

export const VacanciesList = Rpc.make("VacanciesList", {
  payload: Schema.Struct({
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int),
    gate: Schema.optional(Schema.String),
    includeArchived: Schema.optional(Schema.Boolean)
  }),
  success: Schema.Struct({
    items: Schema.Array(VacancySummary),
    total: Schema.Int
  }),
  error: ApiError
})

export const VacanciesGet = Rpc.make("VacanciesGet", {
  payload: Schema.Struct({ id: VacancyId }),
  success: VacancyDetail,
  error: ApiError
})

export const VacanciesUpsert = Rpc.make("VacanciesUpsert", {
  payload: Schema.Struct({
    drafts: Schema.Array(VacancyDraft)
  }),
  success: IngestResult,
  error: ApiError
})

/** Corpus rows whose search card is still the only description we have. */
export const VacanciesHydrationTargets = Rpc.make("VacanciesHydrationTargets", {
  payload: Schema.Struct({
    limit: Schema.optional(Schema.Int),
    /** Descriptions shorter than this count as stubs. */
    minDescriptionLength: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(HydrationTarget),
  error: ApiError
})

export const VacanciesEvaluate = Rpc.make("VacanciesEvaluate", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    /** Fit is computed per resume; when omitted the account default is used. */
    resumeId: Schema.optional(Schema.String),
    fit: Schema.optional(Schema.Int)
  }),
  success: DecisionRecord,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Crawl runs                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The crawler owns fetching and parsing; the cloud owns the run record and the
 * query/vacancy links. These four calls are the whole persistence surface, and
 * the corpus itself still goes through `VacanciesUpsert`.
 */
export const CrawlStart = Rpc.make("CrawlStart", {
  payload: Schema.Struct({
    url: Schema.String,
    startPage: Schema.optional(Schema.Int),
    title: Schema.optional(Schema.String)
  }),
  success: CrawlRun,
  error: ApiError
})

export const CrawlSavePage = Rpc.make("CrawlSavePage", {
  payload: Schema.Struct({
    runId: SearchRunId,
    nextPage: Schema.Int,
    pagesDone: Schema.Int,
    found: Schema.Int,
    /** Ingested vacancies from this page, in card order. */
    vacancyIds: Schema.Array(VacancyId)
  }),
  success: CrawlRun,
  error: ApiError
})

export const CrawlFinish = Rpc.make("CrawlFinish", {
  payload: Schema.Struct({
    runId: SearchRunId,
    status: CrawlFinishStatus,
    nextPage: Schema.Int,
    pagesDone: Schema.Int,
    found: Schema.Int,
    error: Schema.optional(Schema.NullOr(Schema.String))
  }),
  success: CrawlRun,
  error: ApiError
})

export const CrawlStatus = Rpc.make("CrawlStatus", {
  payload: Schema.Struct({ runId: SearchRunId }),
  success: CrawlRun,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Gate and lexicon                                                           */
/* -------------------------------------------------------------------------- */

export const TitlesPreview = Rpc.make("TitlesPreview", {
  payload: Schema.Struct({
    title: Schema.String
  }),
  success: TitleGateResult,
  error: ApiError
})

export const TitlesSetUserVerdict = Rpc.make("TitlesSetUserVerdict", {
  payload: Schema.Struct({
    title: Schema.String,
    verdict: Schema.Literals(["match", "unknown", "reject"]),
    roleFamily: Schema.optional(Schema.String)
  }),
  success: TitleVerdictRecord,
  error: ApiError
})

export const LexiconList = Rpc.make("LexiconList", {
  payload: Schema.Struct({
    query: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(LexiconKeyword),
  error: ApiError
})

export const LexiconUpsert = Rpc.make("LexiconUpsert", {
  payload: Schema.Struct({
    term: Schema.String,
    aliases: Schema.optional(Schema.Array(Schema.String)),
    enabled: Schema.optional(Schema.Boolean)
  }),
  success: LexiconKeyword,
  error: ApiError
})

export const LexiconRemove = Rpc.make("LexiconRemove", {
  payload: Schema.Struct({ id: KeywordId }),
  success: Schema.Struct({ id: KeywordId, deleted: Schema.Boolean }),
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Decisions                                                                  */
/* -------------------------------------------------------------------------- */

export const DecisionsList = Rpc.make("DecisionsList", {
  payload: Schema.Struct({
    verdict: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(DecisionRecord),
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Applications                                                               */
/* -------------------------------------------------------------------------- */

export const ApplicationsList = Rpc.make("ApplicationsList", {
  payload: Schema.Struct({
    state: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(ApplicationRecord),
  error: ApiError
})

export const ApplicationsGet = Rpc.make("ApplicationsGet", {
  payload: Schema.Struct({ id: ApplicationId }),
  success: ApplicationDetail,
  error: ApiError
})

export const ApplicationsCreateFromDecision = Rpc.make("ApplicationsCreateFromDecision", {
  payload: Schema.Struct({
    decisionId: Schema.String,
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(Schema.String),
    mode: Schema.optional(Schema.Literals(["drafts", "auto"]))
  }),
  success: ApplicationRecord,
  error: ApiError
})

export const ApplicationsApprove = Rpc.make("ApplicationsApprove", {
  payload: Schema.Struct({ id: ApplicationId }),
  success: ApplicationRecord,
  error: ApiError
})

export const ApplicationsSkip = Rpc.make("ApplicationsSkip", {
  payload: Schema.Struct({
    id: ApplicationId,
    reason: Schema.optional(Schema.String)
  }),
  success: ApplicationRecord,
  error: ApiError
})

export const ApplicationsRetry = Rpc.make("ApplicationsRetry", {
  payload: Schema.Struct({ id: ApplicationId }),
  success: ApplicationRecord,
  error: ApiError
})

/** The only place an application kit crosses the boundary. */
export const ApplicationsSetKit = Rpc.make("ApplicationsSetKit", {
  payload: Schema.Struct({
    applicationId: ApplicationId,
    formHash: Schema.String,
    letter: Schema.optional(Schema.NullOr(Schema.String)),
    answers: Schema.optional(
      Schema.Array(
        Schema.Struct({
          question: Schema.String,
          answer: Schema.String
        })
      )
    ),
    model: Schema.optional(Schema.NullOr(Schema.String)),
    promptHash: Schema.optional(Schema.NullOr(Schema.String)),
    costUsd: Schema.optional(Schema.NullOr(Schema.Number))
  }),
  success: KitRecord,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Presets                                                                    */
/* -------------------------------------------------------------------------- */

export const PresetsList = Rpc.make("PresetsList", {
  payload: Schema.Struct({
    kind: Schema.optional(Schema.String)
  }),
  success: Schema.Array(PresetRecord),
  error: ApiError
})

export const PresetsUpsert = Rpc.make("PresetsUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(Schema.String),
    kind: Schema.Literals(["explore", "apply"]),
    title: Schema.String,
    filter: Schema.Unknown,
    system: Schema.optional(Schema.Boolean)
  }),
  success: PresetRecord,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Queue                                                                      */
/* -------------------------------------------------------------------------- */

export const QueueStatsGet = Rpc.make("QueueStatsGet", {
  success: QueueStats,
  error: ApiError
})

export const QueueJobsList = Rpc.make("QueueJobsList", {
  payload: Schema.Struct({
    status: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(HarnessJob),
  error: ApiError
})

export const HarnessRegister = Rpc.make("HarnessRegister", {
  payload: Schema.Struct({
    name: Schema.String,
    kinds: Schema.Array(JobKind),
    accounts: Schema.Array(HhAccountId)
  }),
  success: HarnessRegistration,
  error: ApiError
})

export const HarnessLeaseNext = Rpc.make("HarnessLeaseNext", {
  payload: Schema.Struct({
    harnessId: HarnessId,
    /** Device token from `HarnessRegister`; the only credential a harness has. */
    token: Schema.String,
    kinds: Schema.Array(JobKind),
    accounts: Schema.Array(HhAccountId),
    waitSeconds: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    job: Schema.NullOr(HarnessJob)
  }),
  error: ApiError
})

export const HarnessHeartbeat = Rpc.make("HarnessHeartbeat", {
  payload: Schema.Struct({
    harnessId: HarnessId,
    token: Schema.String,
    jobId: HarnessJobId,
    leaseId: LeaseId,
    epoch: Schema.Int
  }),
  success: HeartbeatResult,
  error: ApiError
})

export const HarnessComplete = Rpc.make("HarnessComplete", {
  payload: Schema.Struct({
    harnessId: HarnessId,
    token: Schema.String,
    jobId: HarnessJobId,
    leaseId: LeaseId,
    epoch: Schema.Int,
    exit: HarnessExit
  }),
  success: Schema.Struct({
    status: Schema.String,
    accepted: Schema.Boolean,
    message: Schema.optional(Schema.NullOr(Schema.String))
  }),
  error: ApiError
})

/**
 * Clears the harness token so the device can no longer lease, heartbeat or
 * complete work. Re-registering the harness issues a new token.
 */
export const HarnessRevoke = Rpc.make("HarnessRevoke", {
  payload: Schema.Struct({ harnessId: HarnessId }),
  success: Schema.Struct({
    harnessId: HarnessId,
    revoked: Schema.Boolean
  }),
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Inference                                                                  */
/* -------------------------------------------------------------------------- */

export const InferenceEnqueue = Rpc.make("InferenceEnqueue", {
  payload: Schema.Struct({
    prompt: Schema.String,
    system: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    jsonSchema: Schema.optional(Schema.Unknown),
    hhAccountId: Schema.optional(HhAccountId)
  }),
  success: Schema.Struct({ job: HarnessJob }),
  error: ApiError
})

export const InferenceGet = Rpc.make("InferenceGet", {
  payload: Schema.Struct({ id: HarnessJobId }),
  success: HarnessJob,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* The one group                                                              */
/* -------------------------------------------------------------------------- */

export const OtborRpcs = RpcGroup.make(
  SystemHealth,
  VacanciesList,
  VacanciesGet,
  VacanciesUpsert,
  VacanciesHydrationTargets,
  VacanciesEvaluate,
  CrawlStart,
  CrawlSavePage,
  CrawlFinish,
  CrawlStatus,
  TitlesPreview,
  TitlesSetUserVerdict,
  LexiconList,
  LexiconUpsert,
  LexiconRemove,
  DecisionsList,
  ApplicationsList,
  ApplicationsGet,
  ApplicationsCreateFromDecision,
  ApplicationsApprove,
  ApplicationsSkip,
  ApplicationsRetry,
  ApplicationsSetKit,
  PresetsList,
  PresetsUpsert,
  QueueStatsGet,
  QueueJobsList,
  HarnessRegister,
  HarnessLeaseNext,
  HarnessHeartbeat,
  HarnessComplete,
  HarnessRevoke,
  InferenceEnqueue,
  InferenceGet
)

export type OtborRpcs = RpcGroup.Rpcs<typeof OtborRpcs>

export type OtborApi = RpcClient.RpcClient<OtborRpcs, RpcClientError.RpcClientError>

export const RPC_PATH = "/rpc"
