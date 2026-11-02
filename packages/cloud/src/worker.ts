import { Config, Effect, Layer, Schedule } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import "./env.ts"
import { Database } from "./db/Database.ts"
import * as QueueRepository from "./repositories/QueueRepository.ts"
import { CrawlRunner } from "./services/CrawlRunner.ts"
import { CrawlService } from "./services/CrawlService.ts"
import { CorpusService } from "./services/CorpusService.ts"
import { CurrentUser } from "./services/CurrentUser.ts"
import { EmployerHydrator } from "./services/EmployerHydrator.ts"
import { HydrationRunner } from "./services/HydrationRunner.ts"
import { MailGatewayProvider } from "./services/MailGatewayProvider.ts"
import { MailSync } from "./services/MailSync.ts"
import { ScheduleDispatcher } from "./services/ScheduleDispatcher.ts"
import { runDueSchedules } from "./services/ScheduleWorker.ts"
import { TelegramGatewayProvider } from "./services/TelegramGatewayProvider.ts"
import { TelegramSync } from "./services/TelegramSync.ts"

/**
 * The worker is the only process that repairs leases and runs schedules.
 * It does not execute harness jobs: those belong to edge harnesses. It
 * reclaims what a dead performer left behind, keeps the account leases honest,
 * and turns a due `schedule` row into one bounded crawl, hydration or source
 * sync.
 */
const sweep = Effect.gen(function*() {
  const database = yield* Database

  const recovered = yield* database.asOwner((tx) => QueueRepository.recoverExpired(tx))
  if (recovered.length > 0) {
    yield* Effect.logWarning(`Recovered ${recovered.length} expired lease(s)`)
  }

  const stats = yield* database.asOwner((tx) => QueueRepository.stats(tx))
  yield* Effect.logDebug(
    `queue pending=${stats.pending} leased=${stats.leased} running=${stats.running} ` +
      `needsReconcile=${stats.needsReconcile} oldest=${stats.oldestPendingAgeSeconds}s`
  )
})

/**
 * A scheduled crawl runs as the schedule owner, but `CrawlService` is shared
 * with the request path and therefore needs a `CurrentUser`. The worker never
 * uses it for schedule work; the bootstrap layer is enough to satisfy the
 * service graph.
 */
const base = Layer.merge(Database.layer, CurrentUser.layer)
const crawlServices = Layer.merge(CrawlService.layer, CorpusService.layer).pipe(
  Layer.provide(base)
)
const crawlRunner = CrawlRunner.layer.pipe(Layer.provide(Layer.merge(base, crawlServices)))
const crawlStack = Layer.mergeAll(crawlServices, crawlRunner)

const mailSync = MailSync.layer.pipe(
  Layer.provide(Layer.merge(base, MailGatewayProvider.layer))
)
const telegramSync = TelegramSync.layer.pipe(
  Layer.provide(Layer.merge(base, TelegramGatewayProvider.layer))
)
const hydration = HydrationRunner.layer.pipe(Layer.provide(Layer.merge(base, crawlStack)))
const employers = EmployerHydrator.layer.pipe(Layer.provide(base))

const sourceStack = Layer.mergeAll(crawlStack, hydration, employers, mailSync, telegramSync)
const dispatcher = ScheduleDispatcher.layer.pipe(Layer.provide(Layer.merge(base, sourceStack)))

const WorkerServices = Layer.mergeAll(base, sourceStack, dispatcher)

const program = Effect.gen(function*() {
  const sweepSeconds = yield* Config.Number("WORKER_SWEEP_SECONDS").pipe(Config.withDefault(15))
  const scheduleSeconds = yield* Config.Number("WORKER_SCHEDULE_SECONDS").pipe(
    Config.withDefault(60)
  )

  yield* Effect.logInfo(
    `Lease sweeper started (every ${sweepSeconds}s); schedules every ${scheduleSeconds}s`
  )

  const sweepLoop = sweep.pipe(Effect.repeat(Schedule.spaced(`${sweepSeconds} seconds`)))
  const scheduleLoop = runDueSchedules().pipe(
    Effect.repeat(Schedule.spaced(`${scheduleSeconds} seconds`))
  )

  yield* Effect.all([sweepLoop, scheduleLoop], { concurrency: "unbounded" })
})

program.pipe(
  Effect.provide(WorkerServices),
  Effect.catchCause((cause) => Effect.logError("Worker crashed", cause)),
  NodeRuntime.runMain
)
