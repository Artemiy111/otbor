import { type RpcClient, type RpcClientError, RpcGroup } from "effect/rpc"
import {
  AnalysisInsightsGet,
  AnalysisRun,
  AnalysisStatsGet,
  MarketAnalyticsGet,
  VacancyAnalysisGet
} from "./analysis.ts"
import {
  ApplicationsApprove,
  ApplicationsCreateFromDecision,
  ApplicationsCreateManual,
  ApplicationsGet,
  ApplicationsList,
  ApplicationsRetry,
  ApplicationsSearch,
  ApplicationsRetryCaptcha,
  ApplicationsSetKit,
  ApplicationsSkip,
  VacancyFormGet,
  VacancyFormRefresh,
  VacancyLetterAttach,
  VacancyLetterAttachStatusGet,
  VacancyLetterDraftGet,
  VacancyLetterDraftSave,
  VacancyBrowserDrafts,
  ApplicationsRecordBrowserSubmit
} from "./applications.ts"
import {
  ApplyFilterFromPreset,
  ApplyFilterGet,
  ApplyFilterSet,
  ApplyUsageGet,
  AutoApplyPreview,
  AutoApplyProgress,
  AutoApplyRetry
} from "./apply-filter.ts"
import {
  BlacklistImportHh,
  BlacklistList,
  BlacklistRemove,
  BlacklistUpsert,
  VacancyReject,
  VacancyRejections,
  VacancyUnreject
} from "./blacklist.ts"
import {
  ContactRemove,
  ContactsExtract,
  ContactsList,
  ConversationGet,
  VacancyChatGet,
  VacancyChatRefresh,
  ConversationsList,
  ConversationsSearch,
  ConversationMarkRead,
  ConversationMarkUnread
} from "./contacts.ts"
import {
  CaptchaSolverGet,
  CaptchaSolverSet,
  CaptchaSolverTest,
  LocalModelRemove,
  LocalModelUpsert,
  LocalModelsCheck,
  LocalModelsList
} from "./local-models.ts"
import { CrawlFinish, CrawlRunsList, CrawlSavePage, CrawlStart, CrawlStatus } from "./crawl.ts"
import { DecisionsEvaluateBatch, DecisionsList } from "./decisions.ts"
import { EmployersGet, EmployersList } from "./employers.ts"
import { FitJudgeEnqueue, FitJudgementGet, FitJudgementSave, FitJudgementsList } from "./fit.ts"
import {
  HhAccountRemove,
  HhAccountSessionSet,
  HhAccountSessionStateGet,
  HhAccountSessionStatePut,
  HhAccountSubmitResume,
  HhAccountUpsert,
  HhAccountsList,
  CaptchaSolvesList,
  HhCaptchaEpisodesList
} from "./hh-accounts.ts"
import {
  EmployersHydrateOne,
  EmployersHydrationTargets,
  HydrationStatsRpc,
  ProxyStatusRpc,
  ProxyConfigure,
  ProxyClear,
  VacanciesHydrateOne,
  VacanciesHydrationTargets,
  VacanciesUpsert,
  VacancyFetch,
  VacancyHydrate
} from "./hydration.ts"
import {
  AgentCatalogGet,
  DraftGenerate,
  DraftPromptPreview,
  HarnessReportCatalog,
  InferenceEnqueue,
  InferenceGet
} from "./inference.ts"
import {
  LexiconAliasAdd,
  LexiconAliasRemove,
  LexiconAliasSetTypo,
  LexiconList,
  LexiconRematch,
  LexiconRematchStatus,
  LexiconRemove,
  LexiconUpsert
} from "./lexicon.ts"
import {
  MailAccountRemove,
  MailAccountTest,
  MailAccountUpsert,
  MailAccountsList,
  MailSyncNow
} from "./mail.ts"
import {
  ContactConfirm,
  ContactReject,
  PeopleRelink,
  PersonGet,
  PersonList,
  PersonMerge,
  PersonSplit,
  PersonUpdate
} from "./people.ts"
import { OverviewGet } from "./overview.ts"
import { SettingsGet, SettingsUpdate } from "./settings.ts"
import { PresetsList, PresetsPreview, PresetsRemove, PresetsUpsert } from "./presets.ts"
import {
  HarnessComplete,
  HarnessHeartbeat,
  HarnessLeaseNext,
  HarnessRegister,
  HarnessRevoke,
  HarnessSessionGet,
  HarnessSessionPut,
  QueueConcurrencyGet,
  QueueJobsList,
  QueueJobsSearch,
  QueueStatsGet
} from "./queue.ts"
import {
  ResumeEnrichmentGet,
  ResumeEnrichmentSave,
  ResumeGet,
  ResumeUpsert,
  ResumesList
} from "./resumes.ts"
import {
  ScheduleRemove,
  ScheduleRunNow,
  ScheduleRunsList,
  ScheduleUpsert,
  SchedulesList
} from "./schedules.ts"
import {
  NegotiationsSyncRun,
  NegotiationsSyncStatusGet,
  ResumeSyncRun,
  ResumeSyncStatusGet
} from "./sync.ts"
import { SystemHealth } from "./system.ts"
import {
  TelegramAccountRemove,
  TelegramAccountUpsert,
  TelegramAccountsList,
  TelegramLoginQr,
  TelegramLoginStatus,
  TelegramSyncNow
} from "./telegram.ts"
import { VacanciesEvaluate, VacanciesGet, VacanciesList, VacanciesLookup } from "./vacancies.ts"
import { WritingResume } from "./writing.ts"

export const OtborRpcs = RpcGroup.make(
  SystemHealth,
  VacanciesList,
  VacanciesGet,
  VacanciesLookup,
  VacancyAnalysisGet,
  AnalysisRun,
  AnalysisStatsGet,
  AnalysisInsightsGet,
  MarketAnalyticsGet,
  EmployersList,
  EmployersGet,
  BlacklistList,
  BlacklistUpsert,
  BlacklistRemove,
  BlacklistImportHh,
  VacancyReject,
  VacancyRejections,
  VacancyUnreject,
  VacanciesUpsert,
  VacanciesHydrationTargets,
  VacanciesHydrateOne,
  VacancyFetch,
  VacancyHydrate,
  HydrationStatsRpc,
  EmployersHydrationTargets,
  EmployersHydrateOne,
  ProxyStatusRpc,
  ProxyConfigure,
  ProxyClear,
  LocalModelsList,
  LocalModelsCheck,
  LocalModelUpsert,
  LocalModelRemove,
  CaptchaSolverGet,
  CaptchaSolverSet,
  CaptchaSolverTest,
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
  ConversationsSearch,
  ConversationMarkRead,
  ConversationMarkUnread,
  ConversationGet,
  VacancyChatGet,
  VacancyChatRefresh,
  PersonList,
  PersonGet,
  PersonUpdate,
  PersonMerge,
  PersonSplit,
  ContactConfirm,
  ContactReject,
  PeopleRelink,
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
  HhAccountSessionStateGet,
  HhAccountSessionStatePut,
  HarnessSessionGet,
  HarnessSessionPut,
  HhAccountRemove,
  HhAccountSubmitResume,
  HhCaptchaEpisodesList,
  CaptchaSolvesList,
  SettingsGet,
  SettingsUpdate,
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
  ApplicationsSearch,
  ApplicationsGet,
  ApplicationsCreateFromDecision,
  ApplicationsCreateManual,
  VacancyFormGet,
  VacancyFormRefresh,
  VacancyLetterAttach,
  VacancyLetterAttachStatusGet,
  VacancyLetterDraftGet,
  VacancyLetterDraftSave,
  VacancyBrowserDrafts,
  ApplicationsRecordBrowserSubmit,
  ApplicationsApprove,
  ApplicationsSkip,
  ApplicationsRetry,
  ApplicationsRetryCaptcha,
  ApplicationsSetKit,
  PresetsList,
  PresetsUpsert,
  PresetsRemove,
  PresetsPreview,
  ApplyFilterGet,
  ApplyFilterSet,
  ApplyFilterFromPreset,
  ApplyUsageGet,
  AutoApplyPreview,
  AutoApplyProgress,
  AutoApplyRetry,
  QueueStatsGet,
  QueueConcurrencyGet,
  OverviewGet,
  QueueJobsList,
  QueueJobsSearch,
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
