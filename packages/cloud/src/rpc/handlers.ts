import { OtborRpcs, type ProxyMode, type VacancyId } from "@otbor/contract"
import { Cause, Effect, Layer } from "effect"
import { LocalModelService } from "../services/LocalModelService.ts"
import { ProxyService } from "../services/ProxyService.ts"
import { ApplyFilterService } from "../services/ApplyFilterService.ts"
import { AutoApplyViewService } from "../services/AutoApplyViewService.ts"
import { ApplicationService } from "../services/ApplicationService.ts"
import { BlacklistService } from "../services/BlacklistService.ts"
import { ContactService } from "../services/ContactService.ts"
import { PersonService } from "../services/PersonService.ts"
import { ConversationService } from "../services/ConversationService.ts"
import { CorpusService } from "../services/CorpusService.ts"
import { CurrentUser } from "../services/CurrentUser.ts"
import { CrawlRunner } from "../services/CrawlRunner.ts"
import { CrawlService } from "../services/CrawlService.ts"
import { DecisionService } from "../services/DecisionService.ts"
import { AnalysisRunner } from "../services/AnalysisRunner.ts"
import { AutoApplyRunner } from "../services/AutoApplyRunner.ts"
import { SystemOneClient } from "../services/SystemOneClient.ts"
import { EmployerHydrator } from "../services/EmployerHydrator.ts"
import { HydrationService } from "../services/HydrationService.ts"
import { EvaluationRunner } from "../services/EvaluationRunner.ts"
import { FitJudgeRunner } from "../services/FitJudgeRunner.ts"
import { FitJudgeService } from "../services/FitJudgeService.ts"
import { LexiconService } from "../services/LexiconService.ts"
import { MarketService } from "../services/MarketService.ts"
import { HhAccountService } from "../services/HhAccountService.ts"
import { HydrationRunner } from "../services/HydrationRunner.ts"
import { InferenceService } from "../services/InferenceService.ts"
import { MailGatewayProvider } from "../services/MailGatewayProvider.ts"
import { MailService } from "../services/MailService.ts"
import { MailSync } from "../services/MailSync.ts"
import { LetterAttach } from "../services/LetterAttach.ts"
import { BrowserApply } from "../services/BrowserApply.ts"
import { NegotiationsSync } from "../services/NegotiationsSync.ts"
import { ChatSync } from "../services/ChatSync.ts"
import { ResumeSync } from "../services/ResumeSync.ts"
import { PresetService } from "../services/PresetService.ts"
import { QueueService } from "../services/QueueService.ts"
import { SettingsService } from "../services/SettingsService.ts"
import { ResumeService } from "../services/ResumeService.ts"
import { ScheduleDispatcher } from "../services/ScheduleDispatcher.ts"
import { ScheduleService } from "../services/ScheduleService.ts"
import { SystemService } from "../services/SystemService.ts"
import { TelegramGatewayProvider } from "../services/TelegramGatewayProvider.ts"
import { TelegramService } from "../services/TelegramService.ts"
import { TelegramSync } from "../services/TelegramSync.ts"
import { VacancyAnalysisService } from "../services/VacancyAnalysisService.ts"
import { AgentCatalogService } from "../services/AgentCatalogService.ts"
import { WritingService } from "../services/WritingService.ts"

/**
 * HTTP-лог видит только `POST /rpc/` и не знает, какой метод вызван (в одном
 * запросе их может быть несколько). Поэтому лог пишется здесь: на каждый
 * вызов - имя метода, длительность и исход. Стримы логируются при открытии.
 */
const withRpcLog = <H extends object>(handlers: H): H =>
  Object.fromEntries(
    Object.entries(handlers).map(([tag, handler]) => [
      tag,
      (...args: Array<unknown>) => {
        const result = (handler as (...a: Array<unknown>) => unknown)(...args)
        if (!Effect.isEffect(result)) {
          Effect.runFork(Effect.logInfo(`rpc ${tag} (stream)`))
          return result
        }
        return Effect.suspend(() => {
          const startedAt = Date.now()
          const log = (outcome: string) =>
            Effect.logInfo(`rpc ${tag} ${outcome}`).pipe(
              Effect.annotateLogs({ "rpc.method": tag, "rpc.ms": Date.now() - startedAt })
            )
          return result.pipe(
            Effect.tap(() => log("ok")),
            Effect.tapCause(() => log("failed"))
          )
        })
      }
    ])
  ) as H

/**
 * The RPC boundary is a thin mapping. Every handler is a service method, so
 * the same operations are reachable from the CLI and from a future web app
 * without a second API surface.
 */
export const OtborHandlers = OtborRpcs.toLayer(
  Effect.gen(function*() {
    const system = yield* SystemService
    const corpus = yield* CorpusService
    const vacancyAnalysis = yield* VacancyAnalysisService
    const analysisRunner = yield* AnalysisRunner
    const hydrationStats = yield* HydrationService
    const proxy = yield* ProxyService
    const localModels = yield* LocalModelService
    const employerHydrator = yield* EmployerHydrator
    const hydrationRunner = yield* HydrationRunner
    const evaluation = yield* EvaluationRunner
    const crawl = yield* CrawlService
    const inference = yield* InferenceService
    const writing = yield* WritingService
    const agentCatalog = yield* AgentCatalogService
    const decisions = yield* DecisionService
    const fitJudge = yield* FitJudgeService
    const lexicon = yield* LexiconService
    const market = yield* MarketService
    const applications = yield* ApplicationService
    const presets = yield* PresetService
    const applyFilters = yield* ApplyFilterService
    const autoApplyView = yield* AutoApplyViewService
    const queue = yield* QueueService
    const schedules = yield* ScheduleService
    const contacts = yield* ContactService
    const people = yield* PersonService
    const conversations = yield* ConversationService
    const mail = yield* MailService
    const telegram = yield* TelegramService
    const blacklist = yield* BlacklistService
    const hhAccounts = yield* HhAccountService
    const settings = yield* SettingsService
    const autoApply = yield* AutoApplyRunner
    const resumes = yield* ResumeService
    const negotiations = yield* NegotiationsSync
    const letters = yield* LetterAttach
    const browserApply = yield* BrowserApply
    const chats = yield* ChatSync
    const resumeSync = yield* ResumeSync

    /**
     * Hydration answers the caller first; the fresh content is decided in a
     * detached fiber so the RPC does not wait for the cascade. A failure there
     * is only logged: the sweep schedule picks the vacancy up later.
     */
    const hydrateAndEvaluate = (id: string, proxyMode?: ProxyMode, force?: boolean) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser
        const hydrated = yield* hydrationRunner.hydrateOne(user.userId, id, proxyMode, force)
        if (hydrated) {
          yield* evaluation.evaluateBatch(user.userId, { vacancyIds: [id as VacancyId], limit: 1 }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(`vacancy ${id}: evaluation after hydration failed`, cause)
            ),
            Effect.forkDetach
          )
        }
        return { hydrated }
      })

    return withRpcLog({
      SystemHealth: () => system.health(),

      VacanciesList: (payload) => corpus.list(payload),
      VacanciesGet: ({ id }) => corpus.get(id),
      VacanciesLookup: ({ externalIds }) => corpus.lookup(externalIds),
      VacancyAnalysisGet: ({ vacancyId }) => vacancyAnalysis.get(vacancyId),
      AnalysisRun: ({ limit, delayMs }) =>
        analysisRunner.run({
          limit: Math.min(Math.max(limit ?? 20, 1), 500),
          delayMs: Math.min(Math.max(delayMs ?? 0, 0), 60_000)
        }),
      AnalysisStatsGet: () => vacancyAnalysis.stats(),
      AnalysisInsightsGet: ({ days }) => vacancyAnalysis.insights(days ?? 14),
      EmployersList: (payload) => corpus.employers(payload),
      EmployersGet: ({ id }) => corpus.employer(id),
      BlacklistList: (payload) => blacklist.list(payload),
      BlacklistUpsert: (payload) => blacklist.upsert(payload),
      BlacklistRemove: ({ id }) =>
        blacklist.remove(id).pipe(Effect.map((deleted) => ({ id, deleted }))),
      BlacklistImportHh: (payload) => blacklist.importHh(payload),

      HhAccountsList: () => hhAccounts.list(),
      HhAccountUpsert: (payload) => hhAccounts.upsert(payload),
      HhAccountSessionSet: (payload) => hhAccounts.setSession(payload),
      HhAccountRemove: ({ id }) => hhAccounts.remove(id),
      HhAccountSubmitResume: ({ hhAccountId }) =>
        hhAccounts.resumeSubmits(hhAccountId).pipe(
          Effect.tap(({ applicationIds }) =>
            // Освобождённые автозаявки раннер двигает сразу, не дожидаясь расписания;
            // сбой только в лог: их подхватит и обычный проход.
            applicationIds.length === 0
              ? Effect.void
              : CurrentUser.pipe(
                  Effect.flatMap((user) => autoApply.advance(user.userId, applicationIds)),
                  Effect.catchCause((cause) => Effect.logWarning(`resume: advance failed: ${Cause.pretty(cause)}`)),
                  Effect.forkDetach
                )
          ),
          Effect.map(({ account, applicationIds }) => ({ account, released: applicationIds.length }))
        ),
      HhCaptchaEpisodesList: (payload) => hhAccounts.captchaEpisodes(payload),
      CaptchaSolvesList: (payload) => hhAccounts.captchaSolves(payload),
      SettingsGet: () => settings.get(),
      SettingsUpdate: (payload) => settings.update(payload),

      ResumesList: (payload) => resumes.list(payload?.hhAccountId),
      ResumeGet: ({ id }) => resumes.get(id),
      ResumeUpsert: (payload) => resumes.upsert(payload),
      ResumeEnrichmentGet: ({ resumeId }) => resumes.enrichmentGet(resumeId),
      ResumeEnrichmentSave: ({ resumeId, data }) => resumes.enrichmentSave(resumeId, data),
      VacanciesUpsert: ({ drafts }) => corpus.ingest(drafts),
      VacanciesHydrationTargets: (payload) => corpus.hydrationTargets(payload),
      VacanciesHydrateOne: ({ id, proxyMode, force }) => hydrateAndEvaluate(id, proxyMode, force),
      VacancyFetch: ({ reference }) =>
        Effect.gen(function*() {
          const user = yield* CurrentUser
          const fetched = yield* hydrationRunner.fetchByReference(user.userId, reference)
          return { ...fetched, vacancyId: fetched.vacancyId as VacancyId }
        }),
      VacancyHydrate: ({ id, proxyMode, force }) => hydrateAndEvaluate(id, proxyMode, force),
      ProxyStatus: () => proxy.status(),
      ProxyConfigure: (payload) => proxy.configure(payload),
      ProxyClear: () => proxy.clear(),
      LocalModelsList: () => localModels.list(),
      LocalModelsCheck: () => localModels.check(),
      LocalModelUpsert: (payload) => localModels.upsert(payload),
      LocalModelRemove: ({ id }) => localModels.remove(id),
      CaptchaSolverGet: () => localModels.captchaGet(),
      CaptchaSolverSet: (payload) => localModels.captchaSet(payload),
      CaptchaSolverTest: (payload) => localModels.captchaTest(payload),
      HydrationStats: () => hydrationStats.stats(),
      EmployersHydrationTargets: (payload) => hydrationStats.employerTargets(payload),
      EmployersHydrateOne: ({ id, proxyMode }) =>
        Effect.gen(function*() {
          const user = yield* CurrentUser
          return yield* employerHydrator.hydrateOne(user.userId, id, proxyMode).pipe(
            Effect.map((hydrated) => ({ hydrated }))
          )
        }),
      VacanciesEvaluate: ({ vacancyId, resumeId, fit, includeBlacklisted, hhAccountId }) =>
        decisions.evaluate({
          vacancyId,
          resumeId,
          fit,
          includeBlacklisted,
          hhAccountId
        }),

      CrawlStart: (payload) => crawl.start(payload),
      CrawlSavePage: (payload) => crawl.savePage(payload),
      CrawlFinish: (payload) => crawl.finish(payload),
      CrawlStatus: ({ runId }) => crawl.status(runId),
      CrawlRunsList: (payload) => crawl.listRuns(payload),

      SchedulesList: () => schedules.list(),
      ScheduleUpsert: (payload) => schedules.upsert(payload),
      ScheduleRemove: ({ id }) => schedules.remove(id),
      ScheduleRunNow: ({ id }) => schedules.runNow(id),
      ScheduleRunsList: (payload) => schedules.runs(payload),

      NegotiationsSyncRun: ({ hhAccountId }) => negotiations.run(hhAccountId),
      NegotiationsSyncStatus: ({ hhAccountId }) => negotiations.status(hhAccountId),
      ResumeSyncRun: ({ hhAccountId }) => resumeSync.run(hhAccountId),
      ResumeSyncStatus: ({ hhAccountId }) => resumeSync.status(hhAccountId),

      ContactsList: (payload) => contacts.list(payload),
      ContactRemove: ({ id }) => contacts.remove(id),
      ContactsExtract: () => contacts.extract(),
      PersonList: (payload) => people.list(payload),
      PersonGet: ({ id }) => people.get(id),
      PersonUpdate: ({ id, ...fields }) => people.update(id, fields),
      PersonMerge: ({ into, from }) => people.merge(into, from),
      PersonSplit: ({ contactId }) => people.split(contactId),
      ContactConfirm: ({ contactId }) => people.confirm(contactId),
      ContactReject: ({ contactId }) => people.reject(contactId),
      PeopleRelink: ({ conversationId }) =>
        CurrentUser.pipe(Effect.flatMap((user) => people.relink(user.userId, conversationId))),
      ConversationsList: (payload) => conversations.list(payload),
      ConversationGet: ({ id }) => conversations.get(id),

      MailAccountsList: () => mail.list(),
      MailAccountUpsert: (payload) => mail.upsert(payload),
      MailAccountRemove: ({ id }) => mail.remove(id),
      MailAccountTest: ({ id }) => mail.test(id),
      MailSyncNow: ({ id }) => mail.syncNow(id),

      TelegramAccountsList: () => telegram.list(),
      TelegramAccountUpsert: (payload) => telegram.upsert(payload),
      TelegramAccountRemove: ({ id }) => telegram.remove(id),
      TelegramSyncNow: ({ id }) => telegram.syncNow(id),
      TelegramLoginQr: ({ id }) => telegram.loginQr(id),
      TelegramLoginStatus: ({ id }) => telegram.loginStatus(id),

      MarketAnalyticsGet: (payload) => market.analytics(payload),

      LexiconList: (payload) => lexicon.lexiconList(payload),
      LexiconUpsert: (payload) => lexicon.lexiconUpsert(payload),
      LexiconRematch: () => corpus.rematchStart(),
      LexiconRematchStatus: () => corpus.rematchStatus(),
      LexiconAliasAdd: (payload) => lexicon.lexiconAliasAdd(payload),
      LexiconAliasSetTypo: (payload) => lexicon.lexiconAliasSetTypo(payload),
      LexiconAliasRemove: ({ id }) =>
        lexicon.lexiconAliasRemove(id).pipe(Effect.map((deleted) => ({ id, deleted }))),
      LexiconRemove: ({ id }) =>
        lexicon.lexiconRemove(id).pipe(Effect.map((deleted) => ({ id, deleted }))),

      DecisionsList: (payload) => decisions.list(payload),
      DecisionsEvaluateBatch: (payload) => decisions.evaluateBatch(payload),

      FitJudgeEnqueue: (payload) => fitJudge.enqueue(payload),
      FitJudgementGet: (payload) => fitJudge.get(payload),
      FitJudgementsList: (payload) => fitJudge.list(payload),
      FitJudgementSave: (payload) => fitJudge.save(payload),

      ApplicationsList: (payload) => applications.list(payload),
      ApplicationsGet: ({ id }) => applications.get(id),
      ApplicationsCreateFromDecision: (payload) => applications.createFromDecision(payload),
      ApplicationsCreateManual: (payload) => applications.createManual(payload),
      VacancyFormGet: (payload) => applications.formGet(payload.vacancyId),
      VacancyFormRefresh: (payload) => applications.formRefresh(payload),
      VacancyChatGet: (payload) => chats.get(payload),
      VacancyChatRefresh: (payload) => chats.refresh(payload),
      VacancyLetterAttach: (payload) => letters.attach(payload),
      VacancyLetterAttachStatus: (payload) => letters.status(payload),
      VacancyLetterDraftGet: (payload) => letters.draftGet(payload),
      VacancyLetterDraftSave: (payload) => letters.draftSave(payload),
      VacancyBrowserDrafts: (payload) => browserApply.drafts(payload),
      ApplicationsRecordBrowserSubmit: (payload) => browserApply.recordSubmit(payload),
      ApplicationsApprove: ({ id }) => applications.approve(id),
      ApplicationsSkip: (payload) => applications.skip(payload),
      ApplicationsRetry: ({ id }) => applications.retry(id),
      ApplicationsRetryCaptcha: (payload) => applications.retryCaptcha(payload),
      ApplicationsSetKit: (payload) => applications.setKit(payload),

      PresetsList: (payload) => presets.list(payload),
      PresetsUpsert: (payload) => presets.upsert(payload),
      PresetsRemove: ({ id }) =>
        presets.remove(id).pipe(Effect.map((deleted) => ({ id, deleted }))),
      PresetsPreview: ({ filter }) => presets.preview(filter),

      ApplyFilterGet: (payload) => applyFilters.get(payload),
      ApplyFilterSet: (payload) => applyFilters.set(payload),
      ApplyFilterFromPreset: (payload) => applyFilters.fromPreset(payload),
      ApplyUsageGet: ({ hhAccountId }) => applications.dailyUsage(hhAccountId),
      AutoApplyPreview: (payload) => autoApplyView.preview(payload),
      AutoApplyProgress: (payload) => autoApplyView.progress(payload),
      AutoApplyRetry: (payload) => autoApplyView.retry(payload),

      QueueStatsGet: ({ kind }) => queue.stats(kind),
      QueueConcurrencyGet: () => queue.concurrency(),
      QueueJobsList: (payload) => queue.jobs(payload),

      HarnessRegister: (payload) => queue.register(payload),
      HarnessLeaseNext: (payload) => queue.leaseNext(payload),
      HarnessHeartbeat: (payload) => queue.heartbeat(payload),
      HarnessComplete: (payload) => queue.complete(payload),
      HarnessRevoke: ({ harnessId }) => queue.revoke({ harnessId }),

      InferenceEnqueue: (payload) => inference.enqueue(payload),
      InferenceGet: ({ id }) => inference.get(id),
      HarnessReportCatalog: (payload) => agentCatalog.report(payload),
      AgentCatalogGet: () => agentCatalog.get(),
      DraftGenerate: (payload) => writing.draft(payload),
      DraftPromptPreview: (payload) => writing.draftPrompt(payload),

      WritingResume: (payload) => writing.resume(payload)
    })
  })
)

/**
 * `ScheduleService` and `CrawlRunner` depend on the crawl services, and a
 * merged layer does not feed its siblings. The crawl stack is therefore built
 * once and provided explicitly; `Database` and `CurrentUser` still come from
 * the application runtime above it.
 */
const crawlServices = Layer.merge(CorpusService.layer, CrawlService.layer)
const crawlRunner = CrawlRunner.layer.pipe(Layer.provide(crawlServices))
const crawlStack = Layer.mergeAll(crawlServices, crawlRunner)

/** Source sync services: real transports, credentials from local storage. */
const mailSync = MailSync.layer.pipe(Layer.provide(MailGatewayProvider.layer))
const telegramSync = TelegramSync.layer.pipe(Layer.provide(TelegramGatewayProvider.layer))
const hydration = HydrationRunner.layer.pipe(Layer.provide(crawlStack))
const employers = EmployerHydrator.layer
const analysisRunner = AnalysisRunner.layer.pipe(Layer.provide(SystemOneClient.layer))
const evaluation = EvaluationRunner.layer
const fitRunner = FitJudgeRunner.layer
const resumeSyncService = ResumeSync.layer
const autoApplyRunner = AutoApplyRunner.layer

const sourceStack = Layer.mergeAll(
  crawlStack,
  hydration,
  HydrationService.layer,
  ProxyService.layer,
  LocalModelService.layer,
  employers,
  analysisRunner,
  evaluation,
  fitRunner,
  resumeSyncService,
  autoApplyRunner,
  mailSync,
  telegramSync
)

const dispatcher = ScheduleDispatcher.layer.pipe(Layer.provide(sourceStack))
const scheduleService = ScheduleService.layer.pipe(Layer.provide(dispatcher))
const mailService = MailService.layer.pipe(Layer.provide(mailSync))
const telegramService = TelegramService.layer.pipe(Layer.provide(telegramSync))

/** All services, with their database and user dependencies satisfied. */
export const OtborServices = Layer.mergeAll(
  SystemService.layer.pipe(Layer.provide(SystemOneClient.layer)),
  sourceStack,
  dispatcher,
  scheduleService,
  mailService,
  telegramService,
  BlacklistService.layer,
  HhAccountService.layer,
  ResumeService.layer,
  ContactService.layer,
  PersonService.layer,
  ConversationService.layer,
  InferenceService.layer,
  WritingService.layer,
  AgentCatalogService.layer,
  DecisionService.layer,
  FitJudgeService.layer,
  VacancyAnalysisService.layer,
  LexiconService.layer,
  MarketService.layer,
  ApplicationService.layer,
  PresetService.layer,
  ApplyFilterService.layer,
  AutoApplyViewService.layer.pipe(
    Layer.provide(Layer.merge(ApplicationService.layer, ApplyFilterService.layer))
  ),
  NegotiationsSync.layer,
  LetterAttach.layer,
  BrowserApply.layer,
  ChatSync.layer,
  QueueService.layer,
  SettingsService.layer
)
