import type { UserId } from "@otbor/contract"
import type { MailGateway } from "@otbor/mail"
import type { TelegramGateway } from "@otbor/telegram"
import { Effect, Layer } from "effect"
import { Database } from "../../../src/db/Database.ts"
import { AnalysisRunner } from "../../../src/services/AnalysisRunner.ts"
import { ApplicationService } from "../../../src/services/ApplicationService.ts"
import { BrowserApply } from "../../../src/services/BrowserApply.ts"
import { ApplyFilterService } from "../../../src/services/ApplyFilterService.ts"
import { AutoApplyRunner } from "../../../src/services/AutoApplyRunner.ts"
import { AutoApplyViewService } from "../../../src/services/AutoApplyViewService.ts"
import { BlacklistService } from "../../../src/services/BlacklistService.ts"
import { ContactService } from "../../../src/services/ContactService.ts"
import { ConversationService } from "../../../src/services/ConversationService.ts"
import { CorpusService } from "../../../src/services/CorpusService.ts"
import { CrawlRunner } from "../../../src/services/CrawlRunner.ts"
import { CrawlService } from "../../../src/services/CrawlService.ts"
import { CurrentUser } from "../../../src/services/CurrentUser.ts"
import { DecisionService } from "../../../src/services/DecisionService.ts"
import { EmployerHydrator } from "../../../src/services/EmployerHydrator.ts"
import { EvaluationRunner } from "../../../src/services/EvaluationRunner.ts"
import { FitJudgeRunner } from "../../../src/services/FitJudgeRunner.ts"
import { FitJudgeService } from "../../../src/services/FitJudgeService.ts"
import { HydrationRunner } from "../../../src/services/HydrationRunner.ts"
import { InferenceService } from "../../../src/services/InferenceService.ts"
import { LexiconService } from "../../../src/services/LexiconService.ts"
import { MailGatewayProvider } from "../../../src/services/MailGatewayProvider.ts"
import { MailService } from "../../../src/services/MailService.ts"
import { MailSync } from "../../../src/services/MailSync.ts"
import { NegotiationsSync } from "../../../src/services/NegotiationsSync.ts"
import { PresetService } from "../../../src/services/PresetService.ts"
import { QueueService } from "../../../src/services/QueueService.ts"
import { ResumeService } from "../../../src/services/ResumeService.ts"
import { ResumeSync } from "../../../src/services/ResumeSync.ts"
import { ScheduleDispatcher } from "../../../src/services/ScheduleDispatcher.ts"
import { ScheduleService } from "../../../src/services/ScheduleService.ts"
import { SystemOneClient } from "../../../src/services/SystemOneClient.ts"
import { TelegramGatewayProvider } from "../../../src/services/TelegramGatewayProvider.ts"
import { TelegramService } from "../../../src/services/TelegramService.ts"
import { TelegramSync } from "../../../src/services/TelegramSync.ts"
import { VacancyAnalysisService } from "../../../src/services/VacancyAnalysisService.ts"
import { quiet } from "./database.ts"

export interface LayerOptions {
  readonly runner?: Layer.Layer<CrawlRunner, never, never>
  readonly hydrationRunner?: Layer.Layer<HydrationRunner, never, never>
  /** Replaces the SystemOne model client (default: the configured HTTP one). */
  readonly systemOne?: Layer.Layer<SystemOneClient, never, never>
  readonly mailGateway?: MailGateway
  readonly telegramGateway?: TelegramGateway
}

/**
 * A request layer for an explicit user. Both the owner pool and the
 * `otbor_runtime` transaction role come from the real `Database.layer`; only
 * `CurrentUser` is stubbed so tests can speak as A or B.
 *
 * `runner` replaces the real hh crawler for schedule tests, and the gateways
 * replace IMAP/MTProto. Nothing in the integration suite may reach the
 * network.
 */
export const layerFor = (userId: string, options: LayerOptions = {}) => {
  const shared = Layer.merge(
    Database.layer,
    Layer.succeed(CurrentUser, CurrentUser.of({ userId: userId as UserId }))
  )
  const crawlServices = Layer.merge(CrawlService.layer, CorpusService.layer).pipe(
    Layer.provide(shared)
  )
  const crawlRunner =
    options.runner ??
    CrawlRunner.layer.pipe(Layer.provide(Layer.merge(shared, crawlServices)))
  const crawlStack = Layer.mergeAll(crawlServices, crawlRunner)

  const mailProvider =
    options.mailGateway === undefined
      ? MailGatewayProvider.layer
      : MailGatewayProvider.fixed(options.mailGateway)
  const mailSync = MailSync.layer.pipe(Layer.provide(Layer.merge(shared, mailProvider)))
  const mailService = MailService.layer.pipe(Layer.provide(Layer.merge(shared, mailSync)))

  const telegramProvider =
    options.telegramGateway === undefined
      ? TelegramGatewayProvider.layer
      : TelegramGatewayProvider.fixed(options.telegramGateway)
  const telegramSync = TelegramSync.layer.pipe(
    Layer.provide(Layer.merge(shared, telegramProvider))
  )
  const telegramService = TelegramService.layer.pipe(
    Layer.provide(Layer.merge(shared, telegramSync))
  )

  const hydration =
    options.hydrationRunner ??
    HydrationRunner.layer.pipe(Layer.provide(Layer.merge(shared, crawlStack)))
  const employers = EmployerHydrator.layer.pipe(Layer.provide(shared))
  const analysisRunner = AnalysisRunner.layer.pipe(
    Layer.provide(Layer.merge(shared, options.systemOne ?? SystemOneClient.layer))
  )
  const evaluation = EvaluationRunner.layer.pipe(Layer.provide(shared))
  const fitRunner = FitJudgeRunner.layer.pipe(Layer.provide(shared))
  const resumeSyncService = ResumeSync.layer.pipe(Layer.provide(shared))
  const autoApplyRunner = AutoApplyRunner.layer.pipe(Layer.provide(shared))
  const sourceStack = Layer.mergeAll(
    crawlStack,
    hydration,
    employers,
    analysisRunner,
    evaluation,
    fitRunner,
    resumeSyncService,
    autoApplyRunner,
    mailSync,
    telegramSync
  )
  const dispatcher = ScheduleDispatcher.layer.pipe(
    Layer.provide(Layer.merge(shared, sourceStack))
  )

  return Layer.mergeAll(
    shared,
    sourceStack,
    dispatcher,
    mailService,
    telegramService,
    ContactService.layer.pipe(Layer.provide(shared)),
    ConversationService.layer.pipe(Layer.provide(shared)),
    // These services already depend only on Database + CurrentUser.
    BlacklistService.layer.pipe(Layer.provide(shared)),
    ResumeService.layer.pipe(Layer.provide(shared)),
    VacancyAnalysisService.layer.pipe(Layer.provide(shared)),
    DecisionService.layer.pipe(Layer.provide(shared)),
    FitJudgeService.layer.pipe(Layer.provide(shared)),
    QueueService.layer.pipe(Layer.provide(shared)),
    NegotiationsSync.layer.pipe(Layer.provide(shared)),
    ApplicationService.layer.pipe(Layer.provide(shared)),
    BrowserApply.layer.pipe(Layer.provide(shared)),
    InferenceService.layer.pipe(Layer.provide(shared)),
    LexiconService.layer.pipe(Layer.provide(shared)),
    PresetService.layer.pipe(Layer.provide(shared)),
    ApplyFilterService.layer.pipe(Layer.provide(shared)),
    AutoApplyViewService.layer.pipe(
      Layer.provide(Layer.merge(ApplicationService.layer, ApplyFilterService.layer)),
      Layer.provide(shared)
    ),
    ScheduleService.layer.pipe(Layer.provide(Layer.merge(shared, dispatcher)))
  )
}

type Requirements =
  | Database
  | ApplicationService
  | BrowserApply
  | QueueService
  | NegotiationsSync
  | ResumeSync
  | InferenceService
  | CrawlService
  | LexiconService
  | PresetService
  | ApplyFilterService
  | CorpusService
  | CrawlRunner
  | ScheduleService
  | ScheduleDispatcher
  | MailService
  | TelegramService
  | MailSync
  | TelegramSync
  | ContactService
  | ConversationService
  | HydrationRunner
  | EmployerHydrator
  | AnalysisRunner
  | AutoApplyRunner
  | AutoApplyViewService
  | BlacklistService
  | DecisionService
  | EvaluationRunner
  | FitJudgeRunner
  | FitJudgeService
  | ResumeService
  | VacancyAnalysisService

export const runAs = <A, E>(
  userId: string,
  effect: Effect.Effect<A, E, Requirements>
): Promise<A> =>
  Effect.runPromise(
    quiet(effect.pipe(Effect.provide(layerFor(userId))))
  )

export const runAsWithOptions = <A, E>(
  userId: string,
  options: LayerOptions,
  effect: Effect.Effect<A, E, Requirements>
): Promise<A> =>
  Effect.runPromise(
    quiet(effect.pipe(Effect.provide(layerFor(userId, options))))
  )

export const runAsWithOptionsFailure = <A, E>(
  userId: string,
  options: LayerOptions,
  effect: Effect.Effect<A, E, Requirements>
): Promise<E> =>
  Effect.runPromise(
    quiet(effect.pipe(Effect.flip, Effect.provide(layerFor(userId, options))))
  )

/** Runs an effect expected to fail and returns the typed error. */
export const runAsFailure = <A, E>(
  userId: string,
  effect: Effect.Effect<A, E, Requirements>
): Promise<E> =>
  Effect.runPromise(
    quiet(effect.pipe(Effect.flip, Effect.provide(layerFor(userId))))
  )

/** Same as `runAs`, with a fake CrawlRunner instead of the hh crawler. */
export const runAsWithRunner = <A, E>(
  userId: string,
  runner: Layer.Layer<CrawlRunner, never, never>,
  effect: Effect.Effect<A, E, Requirements>
): Promise<A> =>
  Effect.runPromise(
    quiet(effect.pipe(Effect.provide(layerFor(userId, { runner }))))
  )

export const runAsWithRunnerFailure = <A, E>(
  userId: string,
  runner: Layer.Layer<CrawlRunner, never, never>,
  effect: Effect.Effect<A, E, Requirements>
): Promise<E> =>
  Effect.runPromise(
    quiet(effect.pipe(Effect.flip, Effect.provide(layerFor(userId, { runner }))))
  )
