import { OtborRpcs } from "@otbor/contract"
import { Effect, Layer } from "effect"
import { ApplicationService } from "../services/ApplicationService.ts"
import { CorpusService } from "../services/CorpusService.ts"
import { CrawlService } from "../services/CrawlService.ts"
import { DecisionService } from "../services/DecisionService.ts"
import { GateService } from "../services/GateService.ts"
import { PresetService } from "../services/PresetService.ts"
import { QueueService } from "../services/QueueService.ts"
import { SystemService } from "../services/SystemService.ts"

/**
 * The RPC boundary is a thin mapping. Every handler is a service method, so
 * the same operations are reachable from the CLI and from a future web app
 * without a second API surface.
 */
export const OtborHandlers = OtborRpcs.toLayer(
  Effect.gen(function*() {
    const system = yield* SystemService
    const corpus = yield* CorpusService
    const crawl = yield* CrawlService
    const decisions = yield* DecisionService
    const gate = yield* GateService
    const applications = yield* ApplicationService
    const presets = yield* PresetService
    const queue = yield* QueueService

    return {
      SystemHealth: () => system.health(),

      VacanciesList: (payload) => corpus.list(payload),
      VacanciesGet: ({ id }) => corpus.get(id),
      VacanciesUpsert: ({ drafts }) => corpus.ingest(drafts),
      VacanciesHydrationTargets: (payload) => corpus.hydrationTargets(payload),
      VacanciesEvaluate: ({ vacancyId, resumeId, fit }) =>
        decisions.evaluate({ vacancyId, resumeId, fit }),

      CrawlStart: (payload) => crawl.start(payload),
      CrawlSavePage: (payload) => crawl.savePage(payload),
      CrawlFinish: (payload) => crawl.finish(payload),
      CrawlStatus: ({ runId }) => crawl.status(runId),

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

      QueueStatsGet: () => queue.stats(),
      QueueJobsList: (payload) => queue.jobs(payload),

      HarnessRegister: (payload) => queue.register(payload),
      HarnessLeaseNext: (payload) => queue.leaseNext(payload),
      HarnessHeartbeat: (payload) => queue.heartbeat(payload),
      HarnessComplete: (payload) => queue.complete(payload)
    }
  })
)

/** All services, with their database and user dependencies satisfied. */
export const OtborServices = Layer.mergeAll(
  SystemService.layer,
  CorpusService.layer,
  CrawlService.layer,
  DecisionService.layer,
  GateService.layer,
  ApplicationService.layer,
  PresetService.layer,
  QueueService.layer
)
