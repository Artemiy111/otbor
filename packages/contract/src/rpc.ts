import { Schema } from "effect"
import { Rpc, type RpcClient, type RpcClientError, RpcGroup } from "effect/rpc"
import { AnalysisInsights, AnalysisRunInput, AnalysisRunResult, AnalysisStats, VacancyAnalysis } from "./analysis.ts"
import {
  BlacklistScope,
  EmployerBlacklistView,
  BlacklistTarget,
  ContactKind,
  ContactSource,
  ConversationChannel,
  CrawlFinishStatus,
  JobKind,
  KeywordMatchLocation,
  ProxyMode,
  SourceSyncKind,
  TestsPolicy,
  WritingLanguage
} from "./enums.ts"
import {
  FitEnqueueInput,
  FitEnqueueResult,
  FitJudgement,
  FitJudgementRecord,
  FitJudgementStatus,
  FitSaveResult
} from "./fit.ts"
import {
  ApplicationId,
  BlacklistId,
  ContactId,
  ConversationId,
  EmployerId,
  HhAccountId,
  HarnessId,
  HarnessJobId,
  KeywordAliasId,
  KeywordId,
  LeaseId,
  MailAccountId,
  PresetId,
  ResumeId,
  ScheduleId,
  SearchRunId,
  SearchQueryId,
  TelegramAccountId,
  VacancyId
} from "./ids.ts"
import { ApiError } from "./errors.ts"
import {
  AgentCatalog,
  AgentHarness,
  ApplicationDetail,
  VacancyFormState,
  ApplicationRecord,
  BlacklistRecord,
  ContactRecord,
  ConversationDetail,
  ConversationSummary,
  CrawlRun,
  CrawlSchedule,
  NegotiationsSyncStatus,
  LetterAttachStatus,
  LetterDraft,
  ResumeSyncStatus,
  DecisionRecord,
  EvaluateBatchResult,
  ScheduleRun,
  EmployerDetail,
  EmployerSummary,
  EmployerHydrationTarget,
  HydrationStats,
  ProxyStatus,
  HarnessExit,
  HarnessJob,
  HarnessRegistration,
  Health,
  HeartbeatResult,
  HydrationTarget,
  KitAnswer,
  KitRecord,
  LexiconKeyword,
  HhAccountRecord,
  HhSessionState,
  MailAccountRecord,
  ApplyFilterRecord,
  ApplyFilterView,
  PresetFilter,
  PresetPreview,
  PresetRecord,
  QueueStats,
  ResumeEnrichment,
  ResumeFaqEntry,
  ResumeSalary,
  ResumeRecord,
  SyncResult,
  TelegramAccountRecord,
  TelegramLoginStatusValue,
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

/** Columns the vacancy list can be sorted by on the server. */
export const VacancySortKey = Schema.Literals([
  "title",
  "employer",
  "rating",
  "salary",
  "area",
  "seniority",
  "experience",
  "employment",
  "date",
  "firstSeen",
  "lastSeen",
  "archived",
  "blacklisted",
  "responses",
  "analysed"
])
export type VacancySortKey = typeof VacancySortKey.Type

export const VacancySort = Schema.Struct({
  key: VacancySortKey,
  direction: Schema.Literals(["asc", "desc"])
})
export type VacancySort = typeof VacancySort.Type

export const VacanciesList = Rpc.make("VacanciesList", {
  payload: Schema.Struct({
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int),
    /** `true`: only analysed vacancies; `false`: only not analysed; omitted: all. */
    analysed: Schema.optional(Schema.Boolean),
    /** Only vacancies with an active response (submitted, submitting or queued) from this account. */
    respondedAccountId: Schema.optional(HhAccountId),
    /** Case-insensitive substring of the title, employer name or city. */
    search: Schema.optional(Schema.String),
    /** Sort over the whole filtered set, before the page is cut. Default: newest published first. */
    sort: Schema.optional(VacancySort),
    includeArchived: Schema.optional(Schema.Boolean),
    /** Default `false`: blacklist layers hide rows from the default view. */
    includeBlacklisted: Schema.optional(Schema.Boolean),
    /** Selects the account whose blacklist layers apply to this page. */
    hhAccountId: Schema.optional(HhAccountId),
    /**
     * Ad-hoc rules, compiled by the same builder as presets. They own the
     * archive state (`includeArchived` of the filter, not of the list).
     */
    filter: Schema.optional(PresetFilter)
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

/** The stored model analysis of a vacancy (default prompt version), or null when it was not analysed yet. */
export const VacancyAnalysisGet = Rpc.make("VacancyAnalysisGet", {
  payload: Schema.Struct({ vacancyId: VacancyId }),
  success: Schema.NullOr(VacancyAnalysis),
  error: ApiError
})

/** One bounded pass of the local model over vacancies without a current analysis. Waits for the pass. */
export const AnalysisRun = Rpc.make("AnalysisRun", {
  payload: AnalysisRunInput,
  success: AnalysisRunResult,
  error: ApiError
})

export const AnalysisStatsGet = Rpc.make("AnalysisStatsGet", {
  success: AnalysisStats,
  error: ApiError
})

export const AnalysisInsightsGet = Rpc.make("AnalysisInsightsGet", {
  payload: Schema.Struct({ days: Schema.optional(Schema.Int) }),
  success: AnalysisInsights,
  error: ApiError
})

export const EmployersList = Rpc.make("EmployersList", {
  payload: Schema.Struct({
    query: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int),
    /** The companies page toggle: `true` shows blacklisted employers. */
    includeBlacklisted: Schema.optional(Schema.Boolean),
    /** Overrides `includeBlacklisted` when set. */
    blacklistView: Schema.optional(EmployerBlacklistView),
    /** With `blacklistView = "account"`: only employers this hh account blocked. */
    blockedByAccountId: Schema.optional(HhAccountId),
    hhAccountId: Schema.optional(HhAccountId),
    /** Only employers this hh account has responded to. */
    respondedAccountId: Schema.optional(HhAccountId)
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

export const VacanciesHydrateOne = Rpc.make("VacanciesHydrateOne", {
  payload: Schema.Struct({
    id: VacancyId,
    /** Defaults to the configured proxy when one is set, direct otherwise. */
    proxyMode: Schema.optional(ProxyMode),
    /** Fetch the page even when the stored text is already complete (re-captures hh signals). */
    force: Schema.optional(Schema.Boolean)
  }),
  success: Schema.Struct({ hydrated: Schema.Boolean }),
  error: ApiError
})

/**
 * Manual mode: make sure ONE vacancy is in the corpus. `reference` is an
 * hh.ru vacancy URL or an external id. A known, fully hydrated vacancy is
 * returned as is; otherwise the cloud fetches the public vacancy page through
 * the configured proxy and ingests it (a single GET, never a search).
 */
export const VacancyFetch = Rpc.make("VacancyFetch", {
  payload: Schema.Struct({ reference: Schema.String }),
  success: Schema.Struct({
    vacancyId: VacancyId,
    externalId: Schema.String,
    title: Schema.String,
    /** false when this call fetched and stored the page. */
    alreadyKnown: Schema.Boolean
  }),
  error: ApiError
})

export const VacancyHydrate = Rpc.make("VacancyHydrate", {
  payload: Schema.Struct({
    id: VacancyId,
    proxyMode: Schema.optional(ProxyMode),
    force: Schema.optional(Schema.Boolean)
  }),
  success: Schema.Struct({ hydrated: Schema.Boolean }),
  error: ApiError
})

/** Read-only, safe proxy state: no subscription URL or credentials. */
export const ProxyStatusRpc = Rpc.make("ProxyStatus", {
  success: ProxyStatus,
  error: ApiError
})

/** Overview counters for the vacancy/employer hydration dashboard. */
export const HydrationStatsRpc = Rpc.make("HydrationStats", {
  success: HydrationStats,
  error: ApiError
})

/** Employers backing vacancies, oldest profile first, with gaps made explicit. */
export const EmployersHydrationTargets = Rpc.make("EmployersHydrationTargets", {
  payload: Schema.Struct({
    limit: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(EmployerHydrationTarget),
  error: ApiError
})

export const EmployersHydrateOne = Rpc.make("EmployersHydrateOne", {
  payload: Schema.Struct({
    id: EmployerId,
    proxyMode: Schema.optional(ProxyMode)
  }),
  success: Schema.Struct({ hydrated: Schema.Boolean }),
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
    vacancyIds: Schema.Array(VacancyId),
    currentPage: Schema.optional(Schema.NullOr(Schema.Int)),
    pagesTotal: Schema.optional(Schema.NullOr(Schema.Int)),
    inserted: Schema.optional(Schema.Int),
    updated: Schema.optional(Schema.Int),
    skipped: Schema.optional(Schema.Int)
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

export const ScheduleRunsList = Rpc.make("ScheduleRunsList", {
  payload: Schema.Struct({
    scheduleId: Schema.optional(ScheduleId),
    kind: Schema.optional(SourceSyncKind),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: Schema.Struct({
    items: Schema.Array(ScheduleRun),
    total: Schema.Int
  }),
  error: ApiError
})

/**
 * Reads the account's negotiations list from hh.ru and imports responses made
 * by hand. `NegotiationsSyncRun` only enqueues the browser job (it never waits
 * for hh.ru); `NegotiationsSyncStatus` reads the last job's outcome.
 */
export const NegotiationsSyncRun = Rpc.make("NegotiationsSyncRun", {
  payload: Schema.Struct({ hhAccountId: HhAccountId }),
  success: NegotiationsSyncStatus,
  error: ApiError
})

export const NegotiationsSyncStatusGet = Rpc.make("NegotiationsSyncStatus", {
  payload: Schema.Struct({ hhAccountId: HhAccountId }),
  success: NegotiationsSyncStatus,
  error: ApiError
})

/**
 * Reads the account's resumes from hh.ru into the corpus. `ResumeSyncRun` only
 * enqueues the browser job (it never waits for hh.ru); `ResumeSyncStatusGet`
 * reads the last job's outcome.
 */
export const ResumeSyncRun = Rpc.make("ResumeSyncRun", {
  payload: Schema.Struct({ hhAccountId: HhAccountId }),
  success: ResumeSyncStatus,
  error: ApiError
})

export const ResumeSyncStatusGet = Rpc.make("ResumeSyncStatus", {
  payload: Schema.Struct({ hhAccountId: HhAccountId }),
  success: ResumeSyncStatus,
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
/* hh.ru accounts                                                             */
/* -------------------------------------------------------------------------- */

export const HhAccountsList = Rpc.make("HhAccountsList", {
  success: Schema.Array(HhAccountRecord),
  error: ApiError
})

export const HhAccountUpsert = Rpc.make("HhAccountUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(HhAccountId),
    label: Schema.String,
    isDefault: Schema.optional(Schema.Boolean),
    sessionProfile: Schema.optional(Schema.NullOr(Schema.String)),
    firstName: Schema.optional(Schema.NullOr(Schema.String)),
    lastName: Schema.optional(Schema.NullOr(Schema.String)),
    areaName: Schema.optional(Schema.NullOr(Schema.String)),
    /** `#rrggbb`, or null to go back to the automatic colour. */
    color: Schema.optional(Schema.NullOr(Schema.String))
  }),
  success: HhAccountRecord,
  error: ApiError
})

export const HhAccountSessionSet = Rpc.make("HhAccountSessionSet", {
  payload: Schema.Struct({
    id: HhAccountId,
    state: HhSessionState,
    error: Schema.optional(Schema.NullOr(Schema.String))
  }),
  success: HhAccountRecord,
  error: ApiError
})

export const HhAccountRemove = Rpc.make("HhAccountRemove", {
  payload: Schema.Struct({ id: HhAccountId }),
  success: Schema.Struct({ id: HhAccountId, deleted: Schema.Boolean }),
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Lexicon                                                                    */
/* -------------------------------------------------------------------------- */

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
    /** Edit this keyword (and rename it) instead of matching by term. */
    id: Schema.optional(KeywordId),
    term: Schema.String,
    aliases: Schema.optional(Schema.Array(Schema.String))
  }),
  success: LexiconKeyword,
  error: ApiError
})

/** Progress of the background re-match of every vacancy against the lexicon. */
export const LexiconRematchProgress = Schema.Struct({
  running: Schema.Boolean,
  processed: Schema.Int,
  total: Schema.Int
})

/**
 * Matches are derived data stored at ingest, so a dictionary edit does not
 * touch old vacancies. This starts a detached batch re-match and returns at
 * once; `started` is false when one is already running.
 */
export const LexiconRematch = Rpc.make("LexiconRematch", {
  success: Schema.Struct({ started: Schema.Boolean, progress: LexiconRematchProgress }),
  error: ApiError
})

export const LexiconRematchStatus = Rpc.make("LexiconRematchStatus", {
  success: LexiconRematchProgress,
  error: ApiError
})

export const LexiconAliasAdd = Rpc.make("LexiconAliasAdd", {
  payload: Schema.Struct({
    keywordId: KeywordId,
    alias: Schema.String,
    typo: Schema.optional(Schema.Boolean)
  }),
  success: LexiconKeyword,
  error: ApiError
})

export const LexiconAliasSetTypo = Rpc.make("LexiconAliasSetTypo", {
  payload: Schema.Struct({ id: KeywordAliasId, typo: Schema.Boolean }),
  success: LexiconKeyword,
  error: ApiError
})

export const LexiconAliasRemove = Rpc.make("LexiconAliasRemove", {
  payload: Schema.Struct({ id: KeywordAliasId }),
  success: Schema.Struct({ id: KeywordAliasId, deleted: Schema.Boolean }),
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
    offset: Schema.optional(Schema.Int),
    /** Default `created`: newest decision first. `priority`: best first. */
    orderBy: Schema.optional(Schema.Literals(["priority", "created"])),
    /** Only decisions with `fit >= minFit`. */
    minFit: Schema.optional(Schema.Int),
    /** Only vacancies matched by this preset's filter. */
    presetId: Schema.optional(PresetId),
    /** Only decisions made for this hh account. */
    hhAccountId: Schema.optional(HhAccountId),
    /** Collapse history: keep the newest decision per vacancy and account. */
    latestPerVacancy: Schema.optional(Schema.Boolean),
    /** Only decisions with `fit <= maxFit`. */
    maxFit: Schema.optional(Schema.Int),
    /**
     * Ad-hoc vacancy filter, evaluated by the same SQL builder as presets and
     * ANDed with `presetId` when both are given.
     */
    filter: Schema.optional(PresetFilter),
    /**
     * Overrides `orderBy` when set. `priority` best first, `fit` highest fit,
     * `newest` newest published vacancy, `salary` highest salary (mixed
     * currencies are not converted), `random` a random sample.
     */
    sort: Schema.optional(Schema.Literals(["priority", "fit", "newest", "salary", "random"]))
  }),
  success: Schema.Array(DecisionRecord),
  error: ApiError
})

/**
 * Evaluates the vacancies that have no current decision: none at all, or one
 * made for older vacancy content, or policy version. Bounded by `limit`;
 * call again while `remaining > 0`.
 */
export const DecisionsEvaluateBatch = Rpc.make("DecisionsEvaluateBatch", {
  payload: Schema.Struct({
    limit: Schema.optional(Schema.Int),
    /** Explicit account; omitted uses the user's default hh account. */
    hhAccountId: Schema.optional(HhAccountId),
    resumeId: Schema.optional(Schema.String),
    /** Re-evaluate even when the current decision is fresh. */
    force: Schema.optional(Schema.Boolean),
    /** Restrict the batch to these vacancies. */
    vacancyIds: Schema.optional(Schema.Array(VacancyId)),
    includeBlacklisted: Schema.optional(Schema.Boolean)
  }),
  success: EvaluateBatchResult,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Fit judgements                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Picks the highest-priority decisions that lack a current judgement and
 * enqueues one inference job each. The answer arrives through the harness
 * completion path, which stores the judgement and re-decides the vacancy.
 */
export const FitJudgeEnqueue = Rpc.make("FitJudgeEnqueue", {
  payload: FitEnqueueInput,
  success: FitEnqueueResult,
  error: ApiError
})

/** The newest judgement for a vacancy (optionally for one resume), or null. */
export const FitJudgementGet = Rpc.make("FitJudgementGet", {
  payload: Schema.Struct({ vacancyId: VacancyId, resumeId: Schema.optional(ResumeId) }),
  success: Schema.NullOr(FitJudgementRecord),
  error: ApiError
})

export const FitJudgementsList = Rpc.make("FitJudgementsList", {
  payload: Schema.Struct({
    status: Schema.optional(FitJudgementStatus),
    resumeId: Schema.optional(ResumeId),
    limit: Schema.optional(Schema.Int),
    offset: Schema.optional(Schema.Int)
  }),
  success: Schema.Array(FitJudgementRecord),
  error: ApiError
})

/**
 * Stores a judgement produced outside the harness (a chat agent over MCP) and
 * re-decides the vacancy with it, exactly like a finished inference job.
 */
export const FitJudgementSave = Rpc.make("FitJudgementSave", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    resumeId: Schema.optional(ResumeId),
    judgement: FitJudgement,
    model: Schema.optional(Schema.String)
  }),
  success: FitSaveResult,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Applications                                                               */
/* -------------------------------------------------------------------------- */

export const ApplicationsList = Rpc.make("ApplicationsList", {
  payload: Schema.Struct({
    state: Schema.optional(Schema.String),
    /** Only applications of this hh account. */
    hhAccountId: Schema.optional(HhAccountId),
    /** Only applications to this vacancy (every account and resume). */
    vacancyId: Schema.optional(VacancyId),
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

/**
 * Manual mode: an application the operator chose, without a decision. Policy
 * (verdict, blacklist, fit) is not consulted; at most one application per
 * (account, vacancy) still holds, so an existing one is returned with
 * `created: false`. Queues the same prepare job as a decision-based draft.
 */
export const ApplicationsCreateManual = Rpc.make("ApplicationsCreateManual", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(Schema.String)
  }),
  success: Schema.Struct({ application: ApplicationRecord, created: Schema.Boolean }),
  error: ApiError
})

/** The response form of a vacancy as last read. Never opens hh. */
export const VacancyFormGet = Rpc.make("VacancyFormGet", {
  payload: Schema.Struct({ vacancyId: VacancyId }),
  success: VacancyFormState,
  error: ApiError
})

/**
 * Queues a form read when the stored form is older than a day, or always with
 * `force`. Creates no application. Returns the state as it is now.
 */
export const VacancyFormRefresh = Rpc.make("VacancyFormRefresh", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    force: Schema.optional(Schema.Boolean)
  }),
  success: VacancyFormState,
  error: ApiError
})

/**
 * Adds a cover letter to the response hh already holds for the vacancy. Queues
 * one browser job and returns at once. The same letter is never queued twice.
 */
export const VacancyLetterAttach = Rpc.make("VacancyLetterAttach", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    /** Which response (hh keeps one per resume); required when the account has several. */
    resumeId: Schema.optional(Schema.NullOr(ResumeId)),
    letter: Schema.String
  }),
  success: LetterAttachStatus,
  error: ApiError
})

export const VacancyLetterAttachStatusGet = Rpc.make("VacancyLetterAttachStatus", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(Schema.NullOr(ResumeId))
  }),
  success: LetterAttachStatus,
  error: ApiError
})

/** The unsent letter for one response; every resume has its own. */
export const VacancyLetterDraftGet = Rpc.make("VacancyLetterDraftGet", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    resumeId: Schema.NullOr(ResumeId)
  }),
  success: LetterDraft,
  error: ApiError
})

/** Saves the letter; blank text deletes the draft. */
export const VacancyLetterDraftSave = Rpc.make("VacancyLetterDraftSave", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    resumeId: Schema.NullOr(ResumeId),
    letter: Schema.String
  }),
  success: LetterDraft,
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
    answers: Schema.optional(Schema.Array(KitAnswer)),
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
/* Apply filter                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The filter that applies to (account, resume): the exact row, else the
 * account row (resume null), else the built-in default. `source` says which.
 */
export const ApplyFilterGet = Rpc.make("ApplyFilterGet", {
  payload: Schema.Struct({
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(ResumeId)
  }),
  success: ApplyFilterView,
  error: ApiError
})

/**
 * Upserts the row for exactly (account, resume). Settings left out keep their
 * stored value (defaults on first save). `templatePresetId` is kept unless given.
 */
export const ApplyFilterSet = Rpc.make("ApplyFilterSet", {
  payload: Schema.Struct({
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(ResumeId),
    filter: PresetFilter,
    minFit: Schema.optional(Schema.Int),
    tests: Schema.optional(TestsPolicy),
    freshHalfLifeHours: Schema.optional(Schema.Int),
    templatePresetId: Schema.optional(Schema.NullOr(PresetId))
  }),
  success: ApplyFilterRecord,
  error: ApiError
})

/** Copies the preset's filter into the row for (account, resume); settings stay. */
export const ApplyFilterFromPreset = Rpc.make("ApplyFilterFromPreset", {
  payload: Schema.Struct({
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(ResumeId),
    presetId: PresetId
  }),
  success: ApplyFilterRecord,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* Queue                                                                      */
/* -------------------------------------------------------------------------- */

export const QueueStatsGet = Rpc.make("QueueStatsGet", {
  payload: Schema.Struct({ kind: Schema.optional(JobKind) }),
  success: QueueStats,
  error: ApiError
})

export const QueueJobsList = Rpc.make("QueueJobsList", {
  payload: Schema.Struct({
    status: Schema.optional(Schema.String),
    kind: Schema.optional(JobKind),
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

/** Harness side: the agents, models and efforts this harness found by probing. */
export const HarnessReportCatalog = Rpc.make("HarnessReportCatalog", {
  payload: Schema.Struct({
    harnessId: HarnessId,
    token: Schema.String,
    harnesses: Schema.Array(AgentHarness)
  }),
  success: Schema.Struct({ ok: Schema.Boolean }),
  error: ApiError
})

/** Web side: what the operator can pick from. Never starts an agent. */
export const AgentCatalogGet = Rpc.make("AgentCatalogGet", {
  payload: Schema.Struct({}),
  success: AgentCatalog,
  error: ApiError
})

/** How long the generated cover letter may be. Short is the default. */
export const DraftLetterLength = Schema.Literals(["short", "medium", "long"])

export type DraftLetterLength = typeof DraftLetterLength.Type

/**
 * Draft the cover letter and the employer-test answers of a vacancy in one
 * model call. Needs a stored form (`VacancyFormGet`) so questions and option
 * ids are known. The result is text in the job; the web parses and shows it.
 */
export const DraftGenerate = Rpc.make("DraftGenerate", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(Schema.String),
    length: Schema.optional(DraftLetterLength),
    harness: Schema.String,
    model: Schema.optional(Schema.String),
    effort: Schema.optional(Schema.String)
  }),
  success: Schema.Struct({ job: HarnessJob }),
  error: ApiError
})

/** The exact prompt `DraftGenerate` would send for these inputs. Read-only; calls no model. */
export const DraftPromptPreview = Rpc.make("DraftPromptPreview", {
  payload: Schema.Struct({
    vacancyId: VacancyId,
    hhAccountId: HhAccountId,
    resumeId: Schema.optional(Schema.String),
    length: Schema.optional(DraftLetterLength)
  }),
  success: Schema.Struct({
    system: Schema.String,
    user: Schema.String,
    promptVersion: Schema.String
  }),
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
/* Resumes                                                                    */
/* -------------------------------------------------------------------------- */

export const ResumesList = Rpc.make("ResumesList", {
  payload: Schema.Struct({
    hhAccountId: Schema.optional(HhAccountId)
  }),
  success: Schema.Array(ResumeRecord),
  error: ApiError
})

export const ResumeGet = Rpc.make("ResumeGet", {
  payload: Schema.Struct({ id: ResumeId }),
  success: ResumeRecord,
  error: ApiError
})

export const ResumeUpsert = Rpc.make("ResumeUpsert", {
  payload: Schema.Struct({
    id: Schema.optional(ResumeId),
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
    areaName: Schema.optional(Schema.NullOr(Schema.String)),
    relocation: Schema.optional(Schema.NullOr(Schema.String)),
    businessTripReadiness: Schema.optional(Schema.NullOr(Schema.String)),
    travelTime: Schema.optional(Schema.NullOr(Schema.String)),
    isActive: Schema.optional(Schema.Boolean),
    lastSeenAt: Schema.optional(Schema.String)
  }),
  success: ResumeRecord,
  error: ApiError
})

export const ResumeEnrichmentGet = Rpc.make("ResumeEnrichmentGet", {
  payload: Schema.Struct({ resumeId: ResumeId }),
  success: ResumeEnrichment,
  error: ApiError
})

export const ResumeEnrichmentSave = Rpc.make("ResumeEnrichmentSave", {
  payload: Schema.Struct({
    resumeId: ResumeId,
    data: Schema.Struct({
      comment: Schema.optional(Schema.String),
      currentlyEmployed: Schema.optional(Schema.NullOr(Schema.Boolean)),
      salaries: Schema.optional(Schema.Array(ResumeSalary)),
      faq: Schema.optional(Schema.Array(ResumeFaqEntry)),
      experience: Schema.optional(
        Schema.Array(
          Schema.Struct({
            key: Schema.String,
            employmentType: Schema.optional(Schema.NullOr(Schema.String)),
            comment: Schema.optional(Schema.NullOr(Schema.String)),
            leaveReason: Schema.optional(Schema.NullOr(Schema.String))
          })
        )
      )
    })
  }),
  success: ResumeEnrichment,
  error: ApiError
})

/* -------------------------------------------------------------------------- */
/* The one group                                                              */
/* -------------------------------------------------------------------------- */

export const OtborRpcs = RpcGroup.make(
  SystemHealth,
  VacanciesList,
  VacanciesGet,
  VacancyAnalysisGet,
  AnalysisRun,
  AnalysisStatsGet,
  AnalysisInsightsGet,
  EmployersList,
  EmployersGet,
  BlacklistList,
  BlacklistUpsert,
  BlacklistRemove,
  BlacklistImportHh,
  VacanciesUpsert,
  VacanciesHydrationTargets,
  VacanciesHydrateOne,
  VacancyFetch,
  VacancyHydrate,
  HydrationStatsRpc,
  EmployersHydrationTargets,
  EmployersHydrateOne,
  ProxyStatusRpc,
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
  NegotiationsSyncRun,
  NegotiationsSyncStatusGet,
  ResumeSyncRun,
  ResumeSyncStatusGet,
  ScheduleRunsList,
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
  HhAccountsList,
  HhAccountUpsert,
  HhAccountSessionSet,
  HhAccountRemove,
  LexiconList,
  LexiconUpsert,
  LexiconRematch,
  LexiconRematchStatus,
  LexiconAliasAdd,
  LexiconAliasSetTypo,
  LexiconAliasRemove,
  LexiconRemove,
  DecisionsList,
  DecisionsEvaluateBatch,
  FitJudgeEnqueue,
  FitJudgementGet,
  FitJudgementsList,
  FitJudgementSave,
  ApplicationsList,
  ApplicationsGet,
  ApplicationsCreateFromDecision,
  ApplicationsCreateManual,
  VacancyFormGet,
  VacancyFormRefresh,
  VacancyLetterAttach,
  VacancyLetterAttachStatusGet,
  VacancyLetterDraftGet,
  VacancyLetterDraftSave,
  ApplicationsApprove,
  ApplicationsSkip,
  ApplicationsRetry,
  ApplicationsSetKit,
  PresetsList,
  PresetsUpsert,
  PresetsRemove,
  PresetsPreview,
  ApplyFilterGet,
  ApplyFilterSet,
  ApplyFilterFromPreset,
  QueueStatsGet,
  QueueJobsList,
  HarnessRegister,
  HarnessLeaseNext,
  HarnessHeartbeat,
  HarnessComplete,
  HarnessRevoke,
  InferenceEnqueue,
  HarnessReportCatalog,
  AgentCatalogGet,
  DraftGenerate,
  DraftPromptPreview,
  InferenceGet,
  WritingCoverLetter,
  WritingAnswers,
  WritingResume,
  ResumesList,
  ResumeGet,
  ResumeUpsert,
  ResumeEnrichmentGet,
  ResumeEnrichmentSave
)

export type OtborRpcs = RpcGroup.Rpcs<typeof OtborRpcs>

export type OtborApi = RpcClient.RpcClient<OtborRpcs, RpcClientError.RpcClientError>

export const RPC_PATH = "/rpc"
