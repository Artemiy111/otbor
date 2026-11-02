import { Schema } from "effect"
import { Rpc, type RpcClient, type RpcClientError, RpcGroup } from "effect/rpc"
import {
  BlacklistScope,
  BlacklistTarget,
  ContactKind,
  ContactSource,
  ConversationChannel,
  CrawlFinishStatus,
  JobKind,
  KeywordMatchLocation,
  SourceSyncKind,
  WritingLanguage
} from "./enums.ts"
import {
  ApplicationId,
  BlacklistId,
  ContactId,
  ConversationId,
  EmployerId,
  HhAccountId,
  HarnessId,
  HarnessJobId,
  KeywordId,
  LeaseId,
  MailAccountId,
  PresetId,
  ScheduleId,
  SearchRunId,
  SearchQueryId,
  TelegramAccountId,
  VacancyId
} from "./ids.ts"
import { ApiError } from "./errors.ts"
import {
  ApplicationDetail,
  ApplicationRecord,
  BlacklistRecord,
  ContactRecord,
  ConversationDetail,
  ConversationSummary,
  CrawlRun,
  CrawlSchedule,
  DecisionRecord,
  EmployerDetail,
  EmployerSummary,
  HarnessExit,
  HarnessJob,
  HarnessRegistration,
  Health,
  HeartbeatResult,
  HydrationTarget,
  KitRecord,
  LexiconKeyword,
  MailAccountRecord,
  PresetFilter,
  PresetPreview,
  PresetRecord,
  QueueStats,
  SyncResult,
  TelegramAccountRecord,
  TelegramLoginStatusValue,
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
    includeArchived: Schema.optional(Schema.Boolean),
    /** Default `false`: blacklist layers hide rows from the default view. */
    includeBlacklisted: Schema.optional(Schema.Boolean),
    /** Selects the account whose blacklist layers apply to this page. */
    hhAccountId: Schema.optional(HhAccountId)
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

export const EmployersList = Rpc.make("EmployersList", {
  payload: Schema.Struct({
    query: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int),
    /** The companies page toggle: `true` shows blacklisted employers. */
    includeBlacklisted: Schema.optional(Schema.Boolean),
    hhAccountId: Schema.optional(HhAccountId)
  }),
  success: Schema.Struct({
    items: Schema.Array(EmployerSummary),
    total: Schema.Int
  }),
  error: ApiError
})

export const EmployersGet = Rpc.make("EmployersGet", {
  payload: Schema.Struct({ id: EmployerId }),
  success: EmployerDetail,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Blacklist                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The blacklist is a soft filter: listing with `includeBlacklisted` shows the
 * same corpus rows, marked instead of removed. `scope` is optional so the UI
 * can present app, account and native tabs over one call.
 */
export const BlacklistList = Rpc.make("BlacklistList", {
  payload: Schema.Struct({
    scope: Schema.optional(BlacklistScope),
    hhAccountId: Schema.optional(HhAccountId),
    targetType: Schema.optional(BlacklistTarget),
    query: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    items: Schema.Array(BlacklistRecord),
    total: Schema.Int
  }),
  error: ApiError
})

export const BlacklistUpsert = Rpc.make("BlacklistUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(BlacklistId),
    scope: BlacklistScope,
    hhAccountId: Schema.optional(HhAccountId),
    targetType: BlacklistTarget,
    externalId: Schema.String,
    name: Schema.optional(Schema.String),
    reason: Schema.optional(Schema.String)
  }),
  success: BlacklistRecord,
  error: ApiError
})

export const BlacklistRemove = Rpc.make("BlacklistRemove", {
  payload: Schema.Struct({ id: BlacklistId }),
  success: Schema.Struct({ id: BlacklistId, deleted: Schema.Boolean }),
  error: ApiError
})

/** Import hh's own hidden list; absent entries are never deleted. */
export const BlacklistImportHh = Rpc.make("BlacklistImportHh", {
  payload: Schema.Struct({
    hhAccountId: HhAccountId,
    entries: Schema.Array(
      Schema.Struct({
        targetType: BlacklistTarget,
        externalId: Schema.String,
        name: Schema.optional(Schema.String)
      })
    )
  }),
  success: Schema.Struct({
    imported: Schema.Int,
    updated: Schema.Int,
    skipped: Schema.Int
  }),
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
    fit: Schema.optional(Schema.Int),
    /** Default `false`: a blacklist match is a `blocked_blacklist` skip. */
    includeBlacklisted: Schema.optional(Schema.Boolean),
    /** Explicit account; omitted uses the user's default hh account. */
    hhAccountId: Schema.optional(HhAccountId)
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
    inserted: Schema.optional(Schema.Int),
    updated: Schema.optional(Schema.Int),
    skipped: Schema.optional(Schema.Int),
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

export const CrawlRunsList = Rpc.make("CrawlRunsList", {
  payload: Schema.Struct({
    queryId: Schema.optional(SearchQueryId),
    url: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    items: Schema.Array(CrawlRun),
    total: Schema.Int
  }),
  error: ApiError
})
/* -------------------------------------------------------------------------- */
/* Crawl schedules                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Schedules are user-owned and run by the worker on their interval.
 * `ScheduleRunNow` only accepts the request: the crawl itself runs in a
 * detached fiber, so the RPC returns before a slow hh.ru page does.
 */
export const SchedulesList = Rpc.make("SchedulesList", {
  success: Schema.Array(CrawlSchedule),
  error: ApiError
})

export const ScheduleUpsert = Rpc.make("ScheduleUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(ScheduleId),
    /** Defaults to `search`; the source kinds dispatch to their own runners. */
    kind: Schema.optional(SourceSyncKind),
    targetId: Schema.String,
    intervalMinutes: Schema.Int,
    enabled: Schema.optional(Schema.Boolean),
    options: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
  }),
  success: CrawlSchedule,
  error: ApiError
})

export const ScheduleRemove = Rpc.make("ScheduleRemove", {
  payload: Schema.Struct({ id: ScheduleId }),
  success: Schema.Struct({ id: ScheduleId, deleted: Schema.Boolean }),
  error: ApiError
})

export const ScheduleRunNow = Rpc.make("ScheduleRunNow", {
  payload: Schema.Struct({ id: ScheduleId }),
  success: Schema.Struct({
    accepted: Schema.Boolean,
    schedule: CrawlSchedule
  }),
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Contacts and conversations                                                 */
/* -------------------------------------------------------------------------- */

export const ContactsList = Rpc.make("ContactsList", {
  payload: Schema.Struct({
    query: Schema.optional(Schema.String),
    kind: Schema.optional(ContactKind),
    source: Schema.optional(ContactSource),
    vacancyId: Schema.optional(VacancyId),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    items: Schema.Array(ContactRecord),
    total: Schema.Int
  }),
  error: ApiError
})

export const ContactRemove = Rpc.make("ContactRemove", {
  payload: Schema.Struct({ id: ContactId }),
  success: Schema.Struct({ id: ContactId, deleted: Schema.Boolean }),
  error: ApiError
})

/** Re-runs contact extraction over stored vacancies; useful after parser changes. */
export const ContactsExtract = Rpc.make("ContactsExtract", {
  success: Schema.Struct({
    scanned: Schema.Int,
    contacts: Schema.Int
  }),
  error: ApiError
})

export const ConversationsList = Rpc.make("ConversationsList", {
  payload: Schema.Struct({
    channel: Schema.optional(ConversationChannel),
    query: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(ConversationSummary),
  error: ApiError
})

export const ConversationGet = Rpc.make("ConversationGet", {
  payload: Schema.Struct({ id: ConversationId }),
  success: ConversationDetail,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Mail                                                                       */
/* -------------------------------------------------------------------------- */

export const MailAccountsList = Rpc.make("MailAccountsList", {
  success: Schema.Array(MailAccountRecord),
  error: ApiError
})

export const MailAccountUpsert = Rpc.make("MailAccountUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(MailAccountId),
    label: Schema.String,
    address: Schema.String,
    host: Schema.String,
    port: Schema.Int,
    secure: Schema.optional(Schema.Boolean),
    username: Schema.String,
    /** App password. Omitted keeps the stored secret; never returned. */
    password: Schema.optional(Schema.String),
    includeSent: Schema.optional(Schema.Boolean),
    backfillDays: Schema.optional(Schema.Int),
    enabled: Schema.optional(Schema.Boolean)
  }),
  success: MailAccountRecord,
  error: ApiError
})

export const MailAccountRemove = Rpc.make("MailAccountRemove", {
  payload: Schema.Struct({ id: MailAccountId }),
  success: Schema.Struct({ id: MailAccountId, deleted: Schema.Boolean }),
  error: ApiError
})

export const MailAccountTest = Rpc.make("MailAccountTest", {
  payload: Schema.Struct({ id: MailAccountId }),
  success: Schema.Struct({
    ok: Schema.Boolean,
    address: Schema.String,
    folders: Schema.Int,
    messages: Schema.NullOr(Schema.Int)
  }),
  error: ApiError
})

/** Synchronous on purpose: a manual sync is short and the operator waits. */
export const MailSyncNow = Rpc.make("MailSyncNow", {
  payload: Schema.Struct({ id: MailAccountId }),
  success: SyncResult,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Telegram                                                                   */
/* -------------------------------------------------------------------------- */

export const TelegramAccountsList = Rpc.make("TelegramAccountsList", {
  success: Schema.Array(TelegramAccountRecord),
  error: ApiError
})

export const TelegramAccountUpsert = Rpc.make("TelegramAccountUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(TelegramAccountId),
    label: Schema.String,
    apiId: Schema.Int,
    apiHash: Schema.String,
    phone: Schema.optional(Schema.String)
  }),
  success: TelegramAccountRecord,
  error: ApiError
})

export const TelegramAccountRemove = Rpc.make("TelegramAccountRemove", {
  payload: Schema.Struct({ id: TelegramAccountId }),
  success: Schema.Struct({ id: TelegramAccountId, deleted: Schema.Boolean }),
  error: ApiError
})

export const TelegramSyncNow = Rpc.make("TelegramSyncNow", {
  payload: Schema.Struct({ id: TelegramAccountId }),
  success: SyncResult,
  error: ApiError
})

/** Starts a QR login in a detached fiber and returns the first QR payload. */
export const TelegramLoginQr = Rpc.make("TelegramLoginQr", {
  payload: Schema.Struct({ id: TelegramAccountId }),
  success: Schema.Struct({
    qrUrl: Schema.String,
    expiresAt: Schema.String
  }),
  error: ApiError
})

export const TelegramLoginStatus = Rpc.make("TelegramLoginStatus", {
  payload: Schema.Struct({ id: TelegramAccountId }),
  success: Schema.Struct({
    status: TelegramLoginStatusValue,
    error: Schema.optional(Schema.NullOr(Schema.String))
  }),
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
    limit: Schema.optional(Schema.Int),
    /** Apply this preset's filter to the keyword set and counts. */
    presetId: Schema.optional(PresetId),
    /** Narrow keyword matches to a place: title, body, HH skills, text+skills. */
    location: Schema.optional(KeywordMatchLocation)
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
    filter: Schema.optional(PresetFilter),
    system: Schema.optional(Schema.Boolean)
  }),
  success: PresetRecord,
  error: ApiError
})

export const PresetsRemove = Rpc.make("PresetsRemove", {
  payload: Schema.Struct({ id: PresetId }),
  success: Schema.Struct({ id: PresetId, deleted: Schema.Boolean }),
  error: ApiError
})

/** Counts and facets for the unsaved filter currently being edited. */
export const PresetsPreview = Rpc.make("PresetsPreview", {
  payload: Schema.Struct({ filter: PresetFilter }),
  success: PresetPreview,
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
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Writing is inference with context: the cloud loads the application, the
 * vacancy and the resume, then enqueues one prompt. It never calls a model and
 * never fills a form; the answer is text a human or the harness can use.
 */
export const WritingCoverLetter = Rpc.make("WritingCoverLetter", {
  payload: Schema.Struct({
    applicationId: ApplicationId,
    tone: Schema.optional(Schema.String),
    length: Schema.optional(Schema.Literals(["short", "medium", "long"])),
    language: Schema.optional(WritingLanguage),
    model: Schema.optional(Schema.String)
  }),
  success: Schema.Struct({ job: HarnessJob }),
  error: ApiError
})

export const WritingAnswers = Rpc.make("WritingAnswers", {
  payload: Schema.Struct({
    applicationId: ApplicationId,
    questions: Schema.Array(Schema.String),
    language: Schema.optional(WritingLanguage),
    model: Schema.optional(Schema.String)
  }),
  success: Schema.Struct({ job: HarnessJob }),
  error: ApiError
})

export const WritingResume = Rpc.make("WritingResume", {
  payload: Schema.Struct({
    text: Schema.String,
    targetRole: Schema.optional(Schema.String),
    language: Schema.optional(WritingLanguage),
    model: Schema.optional(Schema.String)
  }),
  success: Schema.Struct({ job: HarnessJob }),
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* The one group                                                              */
/* -------------------------------------------------------------------------- */

export const OtborRpcs = RpcGroup.make(
  SystemHealth,
  VacanciesList,
  VacanciesGet,
  EmployersList,
  EmployersGet,
  BlacklistList,
  BlacklistUpsert,
  BlacklistRemove,
  BlacklistImportHh,
  VacanciesUpsert,
  VacanciesHydrationTargets,
  VacanciesEvaluate,
  CrawlStart,
  CrawlSavePage,
  CrawlFinish,
  CrawlStatus,
  CrawlRunsList,
  SchedulesList,
  ScheduleUpsert,
  ScheduleRemove,
  ScheduleRunNow,
  ContactsList,
  ContactRemove,
  ContactsExtract,
  ConversationsList,
  ConversationGet,
  MailAccountsList,
  MailAccountUpsert,
  MailAccountRemove,
  MailAccountTest,
  MailSyncNow,
  TelegramAccountsList,
  TelegramAccountUpsert,
  TelegramAccountRemove,
  TelegramSyncNow,
  TelegramLoginQr,
  TelegramLoginStatus,
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
  PresetsRemove,
  PresetsPreview,
  QueueStatsGet,
  QueueJobsList,
  HarnessRegister,
  HarnessLeaseNext,
  HarnessHeartbeat,
  HarnessComplete,
  HarnessRevoke,
  InferenceEnqueue,
  InferenceGet,
  WritingCoverLetter,
  WritingAnswers,
  WritingResume
)

export type OtborRpcs = RpcGroup.Rpcs<typeof OtborRpcs>

export type OtborApi = RpcClient.RpcClient<OtborRpcs, RpcClientError.RpcClientError>

export const RPC_PATH = "/rpc"
