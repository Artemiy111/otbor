import { OtborRpcs } from "@otbor/contract"
import { Effect, Layer } from "effect"
import { ApplicationService } from "../services/ApplicationService.ts"
import { BlacklistService } from "../services/BlacklistService.ts"
import { ContactService } from "../services/ContactService.ts"
import { ConversationService } from "../services/ConversationService.ts"
import { CorpusService } from "../services/CorpusService.ts"
import { CurrentUser } from "../services/CurrentUser.ts"
import { CrawlRunner } from "../services/CrawlRunner.ts"
import { CrawlService } from "../services/CrawlService.ts"
import { DecisionService } from "../services/DecisionService.ts"
import { EmployerHydrator } from "../services/EmployerHydrator.ts"
import { GateService } from "../services/GateService.ts"
import { HhAccountService } from "../services/HhAccountService.ts"
import { HydrationRunner } from "../services/HydrationRunner.ts"
import { InferenceService } from "../services/InferenceService.ts"
import { MailGatewayProvider } from "../services/MailGatewayProvider.ts"
import { MailService } from "../services/MailService.ts"
import { MailSync } from "../services/MailSync.ts"
import { PresetService } from "../services/PresetService.ts"
import { QueueService } from "../services/QueueService.ts"
import { ScheduleDispatcher } from "../services/ScheduleDispatcher.ts"
import { ScheduleService } from "../services/ScheduleService.ts"
import { SystemService } from "../services/SystemService.ts"
import { TelegramGatewayProvider } from "../services/TelegramGatewayProvider.ts"
import { TelegramService } from "../services/TelegramService.ts"
import { TelegramSync } from "../services/TelegramSync.ts"
import { WritingService } from "../services/WritingService.ts"

/**
 * The RPC boundary is a thin mapping. Every handler is a service method, so
 * the same operations are reachable from the CLI and from a future web app
 * without a second API surface.
 */
export const OtborHandlers = OtborRpcs.toLayer(
  Effect.gen(function*() {
    const system = yield* SystemService
    const corpus = yield* CorpusService
    const hydrationRunner = yield* HydrationRunner
    const crawl = yield* CrawlService
    const inference = yield* InferenceService
    const writing = yield* WritingService
    const decisions = yield* DecisionService
    const gate = yield* GateService
    const applications = yield* ApplicationService
    const presets = yield* PresetService
    const queue = yield* QueueService
    const schedules = yield* ScheduleService
    const contacts = yield* ContactService
    const conversations = yield* ConversationService
    const mail = yield* MailService
    const telegram = yield* TelegramService
    const blacklist = yield* BlacklistService
    const hhAccounts = yield* HhAccountService

    return {
      SystemHealth: () => system.health(),

      VacanciesList: (payload) => corpus.list(payload),
      VacanciesGet: ({ id }) => corpus.get(id),
      EmployersList: (payload) => corpus.employers(payload),
      EmployersGet: ({ id }) => corpus.employer(id),
      BlacklistList: (payload) => blacklist.list(payload),
      BlacklistUpsert: (payload) => blacklist.upsert(payload),
      BlacklistRemove: ({ id }) =>
        blacklist.remove(id).pipe(Effect.map((deleted) => ({ id, deleted }))),
      BlacklistImportHh: (payload) => blacklist.importHh(payload),

      HhAccountsList: () => hhAccounts.list(),
      HhAccountUpsert: (payload) => hhAccounts.upsert(payload),
      HhAccountRemove: ({ id }) => hhAccounts.remove(id),
      VacanciesUpsert: ({ drafts }) => corpus.ingest(drafts),
      VacanciesHydrationTargets: (payload) => corpus.hydrationTargets(payload),
      VacanciesHydrateOne: ({ id }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* hydrationRunner.hydrateOne(user.userId, id).pipe(
            Effect.map((hydrated) => ({ hydrated }))
          )
        }),
      VacancyHydrate: ({ id }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return yield* hydrationRunner.hydrateOne(user.userId, id).pipe(
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

      ContactsList: (payload) => contacts.list(payload),
      ContactRemove: ({ id }) => contacts.remove(id),
      ContactsExtract: () => contacts.extract(),
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

      TitlesPreview: ({ title }) => gate.preview(title),
      TitlesSetUserVerdict: ({ title, verdict, roleFamily }) =>
        gate.setUserVerdict({ title, verdict, roleFamily }),

      LexiconList: (payload) => gate.lexiconList(payload),
      LexiconUpsert: (payload) => gate.lexiconUpsert(payload),
      LexiconRemove: ({ id }) =>
        gate.lexiconRemove(id).pipe(Effect.map((deleted) => ({ id, deleted }))),

      DecisionsList: (payload) => decisions.list(payload),

      ApplicationsList: (payload) => applications.list(payload),
      ApplicationsGet: ({ id }) => applications.get(id),
      ApplicationsCreateFromDecision: (payload) => applications.createFromDecision(payload),
      ApplicationsApprove: ({ id }) => applications.approve(id),
      ApplicationsSkip: (payload) => applications.skip(payload),
      ApplicationsRetry: ({ id }) => applications.retry(id),
      ApplicationsSetKit: (payload) => applications.setKit(payload),

      PresetsList: (payload) => presets.list(payload),
      PresetsUpsert: (payload) => presets.upsert(payload),
      PresetsRemove: ({ id }) =>
        presets.remove(id).pipe(Effect.map((deleted) => ({ id, deleted }))),
      PresetsPreview: ({ filter }) => presets.preview(filter),

      QueueStatsGet: () => queue.stats(),
      QueueJobsList: (payload) => queue.jobs(payload),

      HarnessRegister: (payload) => queue.register(payload),
      HarnessLeaseNext: (payload) => queue.leaseNext(payload),
      HarnessHeartbeat: (payload) => queue.heartbeat(payload),
      HarnessComplete: (payload) => queue.complete(payload),
      HarnessRevoke: ({ harnessId }) => queue.revoke({ harnessId }),

      InferenceEnqueue: (payload) => inference.enqueue(payload),
      InferenceGet: ({ id }) => inference.get(id),

      WritingCoverLetter: (payload) => writing.coverLetter(payload),
      WritingAnswers: (payload) => writing.answers(payload),
      WritingResume: (payload) => writing.resume(payload)
    }
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

const sourceStack = Layer.mergeAll(
  crawlStack,
  hydration,
  employers,
  mailSync,
  telegramSync
)

const dispatcher = ScheduleDispatcher.layer.pipe(Layer.provide(sourceStack))
const scheduleService = ScheduleService.layer.pipe(Layer.provide(dispatcher))
const mailService = MailService.layer.pipe(Layer.provide(mailSync))
const telegramService = TelegramService.layer.pipe(Layer.provide(telegramSync))

/** All services, with their database and user dependencies satisfied. */
export const OtborServices = Layer.mergeAll(
  SystemService.layer,
  sourceStack,
  dispatcher,
  scheduleService,
  mailService,
  telegramService,
  BlacklistService.layer,
  HhAccountService.layer,
  ContactService.layer,
  ConversationService.layer,
  InferenceService.layer,
  WritingService.layer,
  DecisionService.layer,
  GateService.layer,
  ApplicationService.layer,
  PresetService.layer,
  QueueService.layer
)
